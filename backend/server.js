// backend/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { GoogleAuth } = require('google-auth-library');
const monitoring = require('@google-cloud/monitoring');
const { ClusterManagerClient } = require('@google-cloud/container');
const Redis = require('ioredis');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize Redis client
let redisClient;
try {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  redisClient = new Redis(redisUrl, {
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true
  });
  
  redisClient.on('connect', () => console.log('Redis connected successfully'));
  redisClient.on('error', (err) => console.warn('Redis connection failed:', err.message));
  
  // Test Redis connection
  redisClient.ping().catch(() => {
    console.warn('Redis not available, caching disabled');
    redisClient = null;
  });
} catch (error) {
  console.warn('Redis setup failed, caching disabled:', error.message);
  redisClient = null;
}

// Initialize GCP clients
let monitoringClient, clusterClient, auth;

try {
  auth = new GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/monitoring.read',
      'https://www.googleapis.com/auth/container'
    ]
  });

  monitoringClient = new monitoring.MetricServiceClient({ auth });
  clusterClient = new ClusterManagerClient({ auth });
  console.log('GCP clients initialized successfully');
} catch (error) {
  console.error('GCP authentication failed:', error.message);
  throw new Error('GCP authentication is required. Please set up Application Default Credentials.');
}

// Helper function to format metric filters
const createMetricFilter = (projectId, clusterName, namespace, workloadName, metricType) => {
  let filter = `resource.type="k8s_container" AND resource.labels.project_id="${projectId}" AND resource.labels.cluster_name="${clusterName}"`;
  
  if (namespace && namespace !== 'all') {
    filter += ` AND resource.labels.namespace_name="${namespace}"`;
  }
  
  // Use the correct label for workload name based on your PromQL example
  if (workloadName && workloadName !== 'all') {
    filter += ` AND metadata.system_labels.top_level_controller_name="${workloadName}"`;
  }
  
  filter += ` AND metric.type="${metricType}"`;
  
  return filter;
};

// Helper function to format VPA metric filters (uses k8s_scale resource type)
const createVPAMetricFilter = (projectId, clusterName, namespace, workloadName, metricType) => {
  let filter = `resource.type="k8s_scale" AND resource.labels.project_id="${projectId}" AND resource.labels.cluster_name="${clusterName}"`;
  
  if (namespace && namespace !== 'all') {
    filter += ` AND resource.labels.namespace_name="${namespace}"`;
  }
  
  if (workloadName && workloadName !== 'all') {
    filter += ` AND resource.labels.controller_name="${workloadName}"`;
  }
  
  filter += ` AND metric.type="${metricType}"`;
  
  return filter;
};

// Helper function to format Pod metric filters (uses k8s_pod resource type)
const createPodMetricFilter = (projectId, clusterName, namespace, workloadName, metricType) => {
  let filter = `resource.type="k8s_pod" AND resource.labels.project_id="${projectId}" AND resource.labels.cluster_name="${clusterName}"`;
  
  if (namespace && namespace !== 'all') {
    filter += ` AND resource.labels.namespace_name="${namespace}"`;
  }
  
  if (workloadName && workloadName !== 'all') {
    filter += ` AND metadata.system_labels.top_level_controller_name="${workloadName}"`;
  }
  
  filter += ` AND metric.type="${metricType}"`;
  
  return filter;
};

const createContainerRequestFilter = (projectId, clusterName, namespace, workloadName, metricType) => {
  let filter = `resource.type="k8s_container" AND resource.labels.project_id="${projectId}" AND resource.labels.cluster_name="${clusterName}"`;
  
  if (namespace && namespace !== 'all') {
    filter += ` AND resource.labels.namespace_name="${namespace}"`;
  }
  
  // Use metadata.system_labels.top_level_controller_name for workload filtering
  if (workloadName && workloadName !== 'all') {
    filter += ` AND metadata.system_labels.top_level_controller_name="${workloadName}"`;
  }
  
  filter += ` AND metric.type="${metricType}"`;
  
  return filter;
};

// Cache helper functions
async function getCachedData(key) {
  if (!redisClient) return null;
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.warn('Cache read error:', error.message);
    return null;
  }
}

async function setCachedData(key, data, ttlSeconds = 300) {
  if (!redisClient) return;
  try {
    await redisClient.setex(key, ttlSeconds, JSON.stringify(data));
  } catch (error) {
    console.warn('Cache write error:', error.message);
  }
}

// Cache TTL configuration from environment variables
const CACHE_TTL = {
  METRICS: parseInt(process.env.CACHE_TTL_METRICS) || 120,
  WORKLOADS: parseInt(process.env.CACHE_TTL_WORKLOADS) || 300,
  RESOURCES: parseInt(process.env.CACHE_TTL_RESOURCES) || 600,
  CLUSTER_INFO: parseInt(process.env.CACHE_TTL_CLUSTER_INFO) || 3600
};

// CPU to Memory ratio validation (1 vCPU:1 GiB to 1 vCPU:6.5 GiB)
function validateAndAdjustCPUMemoryRatio(cpuCores, memoryBytes) {
  const memoryGiB = memoryBytes / (1024 * 1024 * 1024);
  const ratio = memoryGiB / cpuCores;
  
  console.log(`🔍 Checking CPU:Memory ratio - ${cpuCores} vCPU:${memoryGiB.toFixed(2)} GiB (ratio: 1:${ratio.toFixed(2)})`);
  
  let adjustedCpu = cpuCores;
  let adjustedMemory = memoryBytes;
  let adjustmentReason = null;
  
  if (ratio < 1) {
    // Too little memory for CPU - increase memory to 1:1 ratio
    adjustedMemory = cpuCores * 1024 * 1024 * 1024; // 1 GiB per vCPU
    adjustmentReason = `Memory increased to maintain minimum 1:1 vCPU:GiB ratio`;
    console.log(`⚡ ${adjustmentReason}`);
  } else if (ratio > 6.5) {
    // Too much memory for CPU - increase CPU to 1:6.5 ratio
    adjustedCpu = memoryGiB / 6.5;
    adjustmentReason = `CPU increased to maintain maximum 1:6.5 vCPU:GiB ratio`;
    console.log(`⚡ ${adjustmentReason}`);
  }
  
  const finalMemoryGiB = adjustedMemory / (1024 * 1024 * 1024);
  const finalRatio = finalMemoryGiB / adjustedCpu;
  
  if (adjustmentReason) {
    console.log(`✅ Adjusted to ${adjustedCpu.toFixed(3)} vCPU:${finalMemoryGiB.toFixed(2)} GiB (ratio: 1:${finalRatio.toFixed(2)})`);
  }
  
  return {
    cpu: adjustedCpu,
    memory: adjustedMemory,
    adjusted: !!adjustmentReason,
    reason: adjustmentReason
  };
}





// Helper function to parse CPU values (supports 'm' suffix for millicores)
function parseCpuValue(cpuStr) {
  if (typeof cpuStr === 'number') return cpuStr;
  
  const str = cpuStr.toString().toLowerCase();
  if (str.endsWith('m')) {
    return parseInt(str.slice(0, -1)); // Remove 'm' and convert to number
  } else {
    return parseFloat(str) * 1000; // Convert cores to millicores
  }
}

// Helper function to parse memory values (supports Ki, Mi, Gi, Ti suffixes)
function parseMemoryValue(memoryStr) {
  if (typeof memoryStr === 'number') return memoryStr;
  
  const str = memoryStr.toString().toLowerCase();
  const multipliers = {
    'ki': 1024,
    'mi': 1024 * 1024,
    'gi': 1024 * 1024 * 1024,
    'ti': 1024 * 1024 * 1024 * 1024,
    'k': 1000,
    'm': 1000 * 1000,
    'g': 1000 * 1000 * 1000,
    't': 1000 * 1000 * 1000 * 1000
  };
  
  for (const [suffix, multiplier] of Object.entries(multipliers)) {
    if (str.endsWith(suffix)) {
      return parseFloat(str.slice(0, -suffix.length)) * multiplier;
    }
  }
  
  // If no suffix, assume bytes
  return parseInt(str);
}

// Function to get running replica count from Cloud Monitoring
async function getRunningReplicaCount(projectId, clusterName, namespace, workloadName, startTime, endTime) {
  try {
    console.log(`🔍 Getting running replica count for workload: ${workloadName}`);
    
    // Use a longer time window (24 hours) to catch all pods that have been active
    const extendedEndTime = new Date();
    const extendedStartTime = new Date(extendedEndTime.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours
    
    console.log(`📊 Using extended time window: ${extendedStartTime.toISOString()} to ${extendedEndTime.toISOString()}`);
    
    // Use pod network metrics to count running replicas
    const replicaMetrics = await getMetricsFromMonitoring(
      projectId,
      clusterName,
      namespace,
      workloadName,
      'kubernetes.io/pod/network/received_bytes_count',
      extendedStartTime,
      extendedEndTime
    );
    
    console.log(`📊 Replica metrics series count: ${replicaMetrics.length}`);
    
    // Count unique pods (replicas) and extract workload type from the time series
    const uniquePods = new Set();
    const podDetails = new Map();
    let workloadType = 'Unknown';
    
    replicaMetrics.forEach(series => {
      const podName = series.resource?.labels?.pod_name;
      
      // Extract workload type from metadata labels if available
      if (!workloadType || workloadType === 'Unknown') {
        // Debug: Log the structure to see what's available
        console.log(`🔍 Checking series structure for workload type:`, {
          resource_labels_keys: Object.keys(series.resource?.labels || {}),
          metric_labels_keys: Object.keys(series.metric?.labels || {}),
          metadata_keys: Object.keys(series.metadata || {}),
          pod_name: series.resource?.labels?.pod_name
        });
        
        const controllerType = series.metadata?.systemLabels?.fields?.top_level_controller_type?.stringValue ||
                              series.metadata?.system_labels?.top_level_controller_type || 
                              series.metadata?.systemLabels?.topLevelControllerType ||
                              series.resource?.labels?.metadata_system_top_level_controller_type ||
                              series.metric?.labels?.metadata_system_top_level_controller_type ||
                              series.resource?.labels?.top_level_controller_type ||
                              series.metric?.labels?.top_level_controller_type;
        
        if (controllerType) {
          workloadType = controllerType;
          console.log(`📊 Detected workload type: ${workloadType}`);
        } else {
          console.log(`❌ No controller type found in this series`);
        }
      }
      
      if (podName) {
        uniquePods.add(podName);
        
        // Get the latest timestamp for this pod to check if it's recent
        let latestTimestamp = 0;
        series.points?.forEach(point => {
          const timestamp = parseInt(point.interval?.endTime?.seconds || 0);
          if (timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
          }
        });
        
        podDetails.set(podName, {
          latestTimestamp: latestTimestamp,
          latestTime: new Date(latestTimestamp * 1000).toISOString()
        });
      }
    });
    
    console.log(`📊 Found ${uniquePods.size} unique pods:`);
    podDetails.forEach((details, podName) => {
      console.log(`  - ${podName}: last activity at ${details.latestTime}`);
    });
    
    const replicaCount = uniquePods.size;
    console.log(`📊 Running replica count for ${workloadName}: ${replicaCount}`);
    
    // If we still don't find enough pods, try an alternative metric
    if (replicaCount < 3) {
      console.log(`⚠️  Found fewer pods than expected (${replicaCount}), trying alternative method...`);
      const altResult = await getReplicaCountAlternative(projectId, clusterName, namespace, workloadName, extendedStartTime, extendedEndTime);
      if (altResult.count > replicaCount) {
        console.log(`📊 Alternative method found ${altResult.count} replicas`);
        return {
          count: altResult.count,
          type: altResult.type || workloadType
        };
      }
    }
    
    return {
      count: replicaCount || 1,
      type: workloadType
    };
  } catch (error) {
    console.warn(`Failed to get replica count for ${workloadName}:`, error.message);
    return {
      count: 1,
      type: 'Unknown'
    }; // Default to 1 replica on error
  }
}

// Alternative method to get replica count using CPU usage metrics
async function getReplicaCountAlternative(projectId, clusterName, namespace, workloadName, startTime, endTime) {
  try {
    console.log(`🔍 Trying alternative replica count method using CPU metrics...`);
    
    // Try using CPU core usage time which should have data for all running pods
    const cpuMetrics = await getMetricsFromMonitoring(
      projectId,
      clusterName,
      namespace,
      workloadName,
      'kubernetes.io/container/cpu/core_usage_time',
      startTime,
      endTime
    );
    
    const uniquePods = new Set();
    let workloadType = 'Unknown';
    
    cpuMetrics.forEach(series => {
      const podName = series.resource?.labels?.pod_name;
      
      // Try to extract workload type from CPU metrics metadata
      if (!workloadType || workloadType === 'Unknown') {
        const controllerType = series.metadata?.system_labels?.top_level_controller_type || 
                              series.metadata?.systemLabels?.topLevelControllerType ||
                              series.resource?.labels?.metadata_system_top_level_controller_type;
        if (controllerType) {
          workloadType = controllerType;
        }
      }
      
      if (podName) {
        uniquePods.add(podName);
      }
    });
    
    console.log(`📊 Alternative method found ${uniquePods.size} pods via CPU metrics`);
    if (uniquePods.size > 0) {
      console.log(`📊 Pods found via CPU metrics:`, Array.from(uniquePods));
    }
    
    return {
      count: uniquePods.size,
      type: workloadType
    };
  } catch (error) {
    console.warn(`Alternative replica count method failed:`, error.message);
    return {
      count: 0,
      type: 'Unknown'
    };
  }
}

// Function to get resource requests from Cloud Monitoring (per-container)
async function getResourceRequestsFromMonitoring(projectId, clusterName, namespace, workloadName, location) {
  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // Last hour
    
    console.log(`🔍 Getting resource requests for workload: ${workloadName}`);
    
    // Get CPU requests (per container) - use original metric name
    const cpuRequestMetrics = await getMetricsFromMonitoring(
      projectId, 
      clusterName, 
      namespace, 
      workloadName, 
      'kubernetes.io/container/cpu/request_cores',
      startTime,
      endTime
    );
    
    // Get Memory requests (per container) - use original metric name without metadata filter
    const memoryRequestMetrics = await getMetricsFromMonitoring(
      projectId, 
      clusterName, 
      namespace, 
      workloadName, 
      'kubernetes.io/container/memory/request_bytes',
      startTime,
      endTime
    );
    
    // Extract per-container requests - filtering now done at query level
    const cpuPerContainer = extractPerContainerValues(cpuRequestMetrics, 'cpu');
    const memoryPerContainer = extractPerContainerValues(memoryRequestMetrics, 'memory');
    
    console.log(`📊 CPU requests per container:`, cpuPerContainer);
    console.log(`📊 Memory requests per container:`, memoryPerContainer);
    
    // Apply CPU:Memory ratio validation to per-container requests
    const adjustedCpuPerContainer = {};
    const adjustedMemoryPerContainer = {};
    const containerRequestAdjustments = {};
    
    Object.keys(cpuPerContainer).forEach(containerName => {
      const containerCpu = cpuPerContainer[containerName];
      const containerMemory = memoryPerContainer[containerName];
      
      if (containerCpu && containerMemory) {
        console.log(`🔍 Validating resource request ratio for container: ${containerName}`);
        const requestRatioValidation = validateAndAdjustCPUMemoryRatio(containerCpu / 1000, containerMemory);
        adjustedCpuPerContainer[containerName] = requestRatioValidation.cpu * 1000;
        adjustedMemoryPerContainer[containerName] = requestRatioValidation.memory;
        if (requestRatioValidation.adjusted) {
          containerRequestAdjustments[containerName] = requestRatioValidation.reason;
        }
      } else {
        adjustedCpuPerContainer[containerName] = containerCpu;
        adjustedMemoryPerContainer[containerName] = containerMemory;
      }
    });
    
    // Calculate totals from adjusted values
    const totalCpuRequest = Object.values(adjustedCpuPerContainer).reduce((sum, val) => sum + val, 0);
    const totalMemoryRequest = Object.values(adjustedMemoryPerContainer).reduce((sum, val) => sum + val, 0);
    
    // Apply ratio validation to totals as well
    let adjustedTotalCpuRequest = totalCpuRequest;
    let adjustedTotalMemoryRequest = totalMemoryRequest;
    let totalRequestAdjustmentReason = null;
    
    if (totalCpuRequest && totalMemoryRequest) {
      console.log(`🔍 Validating total resource request ratio for workload: ${workloadName}`);
      const totalRequestRatioValidation = validateAndAdjustCPUMemoryRatio(totalCpuRequest / 1000, totalMemoryRequest);
      adjustedTotalCpuRequest = totalRequestRatioValidation.cpu * 1000;
      adjustedTotalMemoryRequest = totalRequestRatioValidation.memory;
      totalRequestAdjustmentReason = totalRequestRatioValidation.reason;
    }
    
    return {
      cpuRequest: adjustedTotalCpuRequest,
      memoryRequest: adjustedTotalMemoryRequest,
      cpuPerContainer: adjustedCpuPerContainer,
      memoryPerContainer: adjustedMemoryPerContainer,
      ratioAdjustments: {
        total: totalRequestAdjustmentReason,
        perContainer: containerRequestAdjustments
      }
    };
  } catch (error) {
    console.warn(`Failed to get resource requests for ${workloadName}:`, error.message);
    return {
      cpuRequest: 0,
      memoryRequest: 0,
      cpuPerContainer: {},
      memoryPerContainer: {},
      ratioAdjustments: {
        total: null,
        perContainer: {}
      }
    };
  }
}

// Extract per-container values from resource request metrics
function extractPerContainerValues(timeSeries, metricType) {
  if (!timeSeries || timeSeries.length === 0) return {};
  
  const containerValues = new Map();
  
  timeSeries.forEach(series => {
    const containerName = series.resource?.labels?.container_name || 'unknown';
    
    // No need for pod name filtering since we filter at query level using controller_name
    
    series.points?.forEach(point => {
      const timestamp = parseInt(point.interval?.endTime?.seconds || 0);
      const value = point.value?.doubleValue;
      
      if (value !== undefined) {
        const existing = containerValues.get(containerName);
        if (!existing || timestamp > existing.timestamp) {
          containerValues.set(containerName, {
            value: value,
            timestamp: timestamp
          });
        }
      }
    });
  });
  
  // Convert Map to object with container names as keys
  const result = {};
  containerValues.forEach((data, containerName) => {
    let value = data.value;
    
    // Convert CPU cores to millicores
    if (metricType === 'cpu') {
      value = Math.round(value * 1000);
    } else {
      value = Math.round(value);
    }
    
    result[containerName] = value;
  });
  
  console.log(`📊 Per-container ${metricType} values extracted:`, result);
  return result;
}

// Extract latest value from metrics (legacy function)

// Enhanced Cloud Monitoring query functions
async function getMetricsFromMonitoring(projectId, clusterName, namespace, workloadName, metricType, startTime, endTime) {
  const cacheKey = `metrics_${projectId}_${clusterName}_${namespace || 'all'}_${workloadName || 'all'}_${metricType}_${startTime.getTime()}_${endTime.getTime()}`;
  const cachedMetrics = await getCachedData(cacheKey);
  
  if (cachedMetrics) {
    return cachedMetrics;
  }

  try {
    // Use different filters based on metric type
    let filter;
    if (metricType.includes('autoscaler')) {
      filter = createVPAMetricFilter(projectId, clusterName, namespace, workloadName, metricType);
    } else if (metricType.includes('network/received_bytes_count')) {
      // Pod network metrics use k8s_pod resource type
      filter = createPodMetricFilter(projectId, clusterName, namespace, workloadName, metricType);
    } else if (metricType.includes('request_cores') || metricType.includes('request_bytes')) {
      // Container request metrics use k8s_container resource type without metadata filters
      filter = createContainerRequestFilter(projectId, clusterName, namespace, workloadName, metricType);
    } else {
      filter = createMetricFilter(projectId, clusterName, namespace, workloadName, metricType);
    }
    
    console.log(`🔍 Metrics query for ${metricType}:`, {
      filter: filter,
      projectId: projectId,
      clusterName: clusterName,
      namespace: namespace,
      workloadName: workloadName,
      isVPAMetric: metricType.includes('autoscaler')
    });
    
    // Different aggregation for different metric types
    let aggregation;
    if (metricType.includes('autoscaler')) {
      // VPA recommendations - group by container for multi-container support
      aggregation = {
        alignmentPeriod: { seconds: 300 },
        perSeriesAligner: 'ALIGN_MEAN',
        crossSeriesReducer: 'REDUCE_MEAN',
        groupByFields: ['metric.labels.container_name']
      };
    } else if (metricType.includes('request_cores') || metricType.includes('request_bytes')) {
      // Resource requests (gauge metrics) - group by container only for cleaner aggregation
      aggregation = {
        alignmentPeriod: { seconds: 60 },
        perSeriesAligner: 'ALIGN_MEAN',
        crossSeriesReducer: 'REDUCE_MEAN',
        groupByFields: ['resource.labels.container_name']
      };
    } else if (metricType.includes('used_bytes')) {
      // Memory usage (gauge metrics)
      aggregation = {
        alignmentPeriod: { seconds: 60 },
        perSeriesAligner: 'ALIGN_MEAN',
        crossSeriesReducer: 'REDUCE_MEAN',
        groupByFields: ['resource.labels.container_name', 'resource.labels.pod_name']
      };
    } else if (metricType.includes('network/received_bytes_count')) {
      // Pod network metrics for replica counting - include metadata to capture workload type
      aggregation = {
        alignmentPeriod: { seconds: 60 },
        perSeriesAligner: 'ALIGN_RATE',
        crossSeriesReducer: 'REDUCE_MEAN',
        groupByFields: [
          'resource.labels.pod_name',
          'metadata.system_labels.top_level_controller_type',
          'metadata.system_labels.top_level_controller_name'
        ]
      };
    } else {
      // Usage metrics (cumulative metrics)
      aggregation = {
        alignmentPeriod: { seconds: 60 },
        perSeriesAligner: 'ALIGN_RATE',
        crossSeriesReducer: 'REDUCE_SUM',
        groupByFields: ['resource.labels.container_name', 'resource.labels.pod_name']
      };
    }
    
    const [response] = await monitoringClient.listTimeSeries({
      name: `projects/${projectId}`,
      filter: filter,
      interval: {
        startTime: { seconds: Math.floor(startTime.getTime() / 1000) },
        endTime: { seconds: Math.floor(endTime.getTime() / 1000) }
      },
      view: 'FULL',
      aggregation: aggregation
    });

    // Cache metrics
    await setCachedData(cacheKey, response, CACHE_TTL.METRICS);
    
    return response;
  } catch (error) {
    console.error(`Error fetching ${metricType} metrics:`, error);
    throw new Error(`Failed to fetch ${metricType} metrics: ${error.message}`);
  }
}

// Function to get VPA recommendations specifically
async function getVPARecommendations(projectId, clusterName, namespace, workloadName, startTime, endTime) {
  const cacheKey = `vpa_recommendations_${projectId}_${clusterName}_${namespace || 'all'}_${workloadName || 'all'}_${startTime.getTime()}`;
  const cachedRecommendations = await getCachedData(cacheKey);
  
  if (cachedRecommendations) {
    console.log(`🔄 Using cached VPA recommendations for ${workloadName}:`, cachedRecommendations);
    return cachedRecommendations;
  }

  console.log(`🔍 Fetching VPA recommendations for workload: ${workloadName} in namespace: ${namespace}`);
  
  try {
    // Get VPA CPU recommendations
    console.log(`📊 Fetching VPA CPU recommendations...`);
    const cpuRecommendations = await getMetricsFromMonitoring(
      projectId, 
      clusterName, 
      namespace, 
      workloadName, 
      'kubernetes.io/autoscaler/container/cpu/per_replica_recommended_request_cores',
      startTime,
      endTime
    );
    console.log(`📊 VPA CPU recommendations raw data:`, JSON.stringify(cpuRecommendations, null, 2));

    // Get VPA Memory recommendations
    console.log(`📊 Fetching VPA Memory recommendations...`);
    const memoryRecommendations = await getMetricsFromMonitoring(
      projectId, 
      clusterName, 
      namespace, 
      workloadName, 
      'kubernetes.io/autoscaler/container/memory/per_replica_recommended_request_bytes',
      startTime,
      endTime
    );
    console.log(`📊 VPA Memory recommendations raw data:`, JSON.stringify(memoryRecommendations, null, 2));

    const cpuValue = extractLatestRecommendation(cpuRecommendations);
    const memoryValue = extractLatestRecommendation(memoryRecommendations);
    const cpuPerContainer = extractPerContainerRecommendations(cpuRecommendations);
    const memoryPerContainer = extractPerContainerRecommendations(memoryRecommendations);
    
    console.log(`📊 Extracted VPA values - CPU: ${cpuValue}, Memory: ${memoryValue}`);
    console.log(`📊 Per-container CPU recommendations:`, cpuPerContainer);
    console.log(`📊 Per-container Memory recommendations:`, memoryPerContainer);

    // Apply CPU:Memory ratio validation to total recommendations
    let adjustedTotalCpu = cpuValue;
    let adjustedTotalMemory = memoryValue;
    let totalAdjustmentReason = null;
    
    if (cpuValue && memoryValue) {
      const totalRatioValidation = validateAndAdjustCPUMemoryRatio(cpuValue, memoryValue);
      adjustedTotalCpu = totalRatioValidation.cpu;
      adjustedTotalMemory = totalRatioValidation.memory;
      totalAdjustmentReason = totalRatioValidation.reason;
    }

    // Apply CPU:Memory ratio validation to per-container recommendations
    const adjustedCpuPerContainer = {};
    const adjustedMemoryPerContainer = {};
    const containerAdjustments = {};
    
    Object.keys(cpuPerContainer).forEach(containerName => {
      const containerCpu = cpuPerContainer[containerName];
      const containerMemory = memoryPerContainer[containerName];
      
      if (containerCpu && containerMemory) {
        const containerRatioValidation = validateAndAdjustCPUMemoryRatio(containerCpu, containerMemory);
        adjustedCpuPerContainer[containerName] = containerRatioValidation.cpu;
        adjustedMemoryPerContainer[containerName] = containerRatioValidation.memory;
        if (containerRatioValidation.adjusted) {
          containerAdjustments[containerName] = containerRatioValidation.reason;
        }
      } else {
        adjustedCpuPerContainer[containerName] = containerCpu;
        adjustedMemoryPerContainer[containerName] = containerMemory;
      }
    });

    const recommendations = {
      cpu: adjustedTotalCpu,
      memory: adjustedTotalMemory,
      cpuPerContainer: adjustedCpuPerContainer,
      memoryPerContainer: adjustedMemoryPerContainer,
      available: cpuRecommendations.length > 0 || memoryRecommendations.length > 0,
      ratioAdjustments: {
        total: totalAdjustmentReason,
        perContainer: containerAdjustments
      }
    };

    console.log(`✅ Final VPA recommendations for ${workloadName}:`, recommendations);

    // Cache VPA recommendations for longer period (30 minutes)
    await setCachedData(cacheKey, recommendations, 1800);
    
    return recommendations;
  } catch (error) {
    console.error(`❌ VPA recommendations failed for workload ${workloadName}:`, {
      error: error.message,
      stack: error.stack,
      projectId,
      clusterName,
      namespace,
      workloadName
    });
    return {
      cpu: null,
      memory: null,
      available: false
    };
  }
}

// Extract per-container recommendation values from time series data
function extractPerContainerRecommendations(timeSeries) {
  if (!timeSeries || timeSeries.length === 0) return {};
  
  const containerRecommendations = new Map();
  
  timeSeries.forEach(series => {
    const containerName = series.metric?.labels?.container_name || 'unknown';
    
    series.points?.forEach(point => {
      const timestamp = parseInt(point.interval?.endTime?.seconds || 0);
      const value = point.value?.doubleValue;
      
      if (value !== undefined) {
        const existing = containerRecommendations.get(containerName);
        if (!existing || timestamp > existing.timestamp) {
          containerRecommendations.set(containerName, {
            value: value,
            timestamp: timestamp
          });
        }
      }
    });
  });
  
  // Convert Map to object with container names as keys
  const result = {};
  containerRecommendations.forEach((recommendation, containerName) => {
    result[containerName] = recommendation.value;
  });
  
  console.log(`📊 Per-container recommendations extracted:`, result);
  return result;
}

// Extract the latest recommendation value from time series data (legacy function for backward compatibility)
function extractLatestRecommendation(timeSeries) {
  const perContainer = extractPerContainerRecommendations(timeSeries);
  
  if (Object.keys(perContainer).length === 0) return null;
  
  // Sum up recommendations from all containers
  let totalRecommendation = 0;
  Object.values(perContainer).forEach(value => {
    totalRecommendation += value;
  });
  
  return totalRecommendation;
}

// Get available GCP projects
app.get('/api/projects', async (req, res) => {
  try {
    const authClient = await auth.getClient();
    const projectId = await auth.getProjectId();
    
    // For simplicity, return current project. In production, you'd list all accessible projects
    const projects = [
      {
        id: projectId,
        name: `Project ${projectId}`,
        displayName: projectId
      }
    ];
    
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ 
      error: 'Failed to fetch projects',
      details: 'Unable to authenticate with Google Cloud. Please check your Application Default Credentials.'
    });
  }
});

// Get GKE clusters for a project
app.get('/api/projects/:projectId/clusters', async (req, res) => {
  try {
    const { projectId } = req.params;
    const parent = `projects/${projectId}/locations/-`;
    
    const [response] = await clusterClient.listClusters({
      parent: parent
    });
    
    const clusters = response.clusters?.map(cluster => ({
      name: cluster.name,
      location: cluster.location,
      status: cluster.status,
      nodeCount: cluster.currentNodeCount,
      zone: cluster.zone || cluster.location
    })) || [];
    
    res.json(clusters);
  } catch (error) {
    console.error('Error fetching clusters:', error);
    res.status(500).json({ 
      error: 'Failed to fetch clusters',
      details: `Unable to fetch clusters for project ${req.params.projectId}. Please check your permissions and project ID.`
    });
  }
});

// Get namespaces for a cluster (DISABLED - requires Kubernetes cluster access)
// This endpoint has been disabled as it requires direct Kubernetes cluster connectivity.
// Namespaces should now be provided as part of the workload data in the /api/metrics endpoint.
app.get('/api/projects/:projectId/locations/:location/clusters/:clusterName/namespaces', async (req, res) => {
  res.status(501).json({
    error: 'Endpoint disabled',
    details: 'Direct Kubernetes cluster access has been disabled. Please provide namespace information in the workload data when calling /api/metrics.'
  });
});

// Get workloads for a namespace (DISABLED - requires Kubernetes cluster access)
// This endpoint has been disabled as it requires direct Kubernetes cluster connectivity.
// Workload information should now be provided directly in the /api/metrics endpoint.
app.get('/api/projects/:projectId/locations/:location/clusters/:clusterName/namespaces/:namespace/workloads', async (req, res) => {
  res.status(501).json({
    error: 'Endpoint disabled',
    details: 'Direct Kubernetes cluster access has been disabled. Please provide workload information directly when calling /api/metrics.'
  });
});

// Get metrics for workloads
app.post('/api/metrics', async (req, res) => {
  try {
    const { projectId, clusterName, namespace, workloadName, timeRange, workloads } = req.body;
    
    // Validate required parameters
    if (!projectId || !clusterName) {
      return res.status(400).json({ 
        error: 'Missing required parameters: projectId and clusterName',
        details: 'Both projectId and clusterName are required to fetch metrics'
      });
    }

    // Validate parameter formats
    if (!/^[a-z0-9-]+$/.test(projectId)) {
      return res.status(400).json({ 
        error: 'Invalid projectId format',
        details: 'Project ID must contain only lowercase letters, numbers, and hyphens'
      });
    }

    if (!/^[a-z0-9-]+$/.test(clusterName)) {
      return res.status(400).json({ 
        error: 'Invalid clusterName format',
        details: 'Cluster name must contain only lowercase letters, numbers, and hyphens'
      });
    }

    // Validate optional parameters
    if (namespace && !/^[a-z0-9-]+$/.test(namespace)) {
      return res.status(400).json({ 
        error: 'Invalid namespace format',
        details: 'Namespace must contain only lowercase letters, numbers, and hyphens'
      });
    }

    if (workloadName && !/^[a-z0-9-]+$/.test(workloadName)) {
      return res.status(400).json({ 
        error: 'Invalid workloadName format',
        details: 'Workload name must contain only lowercase letters, numbers, and hyphens'
      });
    }

    if (timeRange && (isNaN(timeRange) || timeRange < 1 || timeRange > 168)) {
      return res.status(400).json({ 
        error: 'Invalid timeRange',
        details: 'Time range must be a number between 1 and 168 hours'
      });
    }
    

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - (timeRange || 1) * 60 * 60 * 1000);
    
    try {
      // Use provided workloads or create from single workload parameters
      let workloadsList = workloads || [];
      
      // If no workloads array provided, create from individual parameters
      if (workloadsList.length === 0 && workloadName) {
        workloadsList = [{
          name: workloadName,
          namespace: namespace || 'default',
          type: 'Unknown',
          replicas: 1
        }];
      }
      
      // If still no workloads, return error
      if (workloadsList.length === 0) {
        return res.status(400).json({
          error: 'No workloads specified',
          details: 'Please provide either a workloadName or a workloads array in the request body'
        });
      }
      
      const metricsData = [];
      
      for (const workload of workloadsList) {
        try {
          // Get actual running replica count and workload type from GCP
          const replicaInfo = await getRunningReplicaCount(
            projectId,
            clusterName, 
            workload.namespace,
            workload.name,
            startTime,
            endTime
          );
          
          const actualReplicas = replicaInfo.count;
          const actualWorkloadType = replicaInfo.type;
          
          console.log(`📊 Actual running replicas for ${workload.name}: ${actualReplicas}`);
          console.log(`📊 Detected workload type for ${workload.name}: ${actualWorkloadType}`);
          
          // Get resource requests from Cloud Monitoring metrics (with per-container breakdown)
          const resourceRequests = await getResourceRequestsFromMonitoring(
            projectId, 
            clusterName, 
            workload.namespace, 
            workload.name
          );
          
          console.log(`📊 Resource requests for ${workload.name}:`, resourceRequests);
          
          // CPU utilization metrics from Cloud Monitoring
          const cpuResponse = await getMetricsFromMonitoring(
            projectId, 
            clusterName, 
            workload.namespace, 
            workload.name, 
            'kubernetes.io/container/cpu/core_usage_time',
            startTime,
            endTime
          );
          
          // Memory utilization metrics from Cloud Monitoring
          const memoryResponse = await getMetricsFromMonitoring(
            projectId, 
            clusterName, 
            workload.namespace, 
            workload.name, 
            'kubernetes.io/container/memory/used_bytes',
            startTime,
            endTime
          );

          // Get VPA recommendations
          console.log(`🎯 Getting VPA recommendations for workload: ${workload.name}`);
          const vpaRecommendations = await getVPARecommendations(
            projectId,
            clusterName,
            workload.namespace,
            workload.name,
            startTime,
            endTime
          );
          console.log(`🎯 VPA recommendations result for ${workload.name}:`, vpaRecommendations);
          
          // Create resources object from monitoring data
          const resources = {
            requests: {
              cpu: resourceRequests.cpuRequest,
              memory: resourceRequests.memoryRequest
            },
            limits: {
              cpu: workload.cpuLimit || 0,
              memory: workload.memoryLimit || 0
            }
          };
          
          // Process and format the metrics data
          const cpuUsage = calculateCurrentUsage(cpuResponse);
          const memoryUsage = calculateCurrentUsage(memoryResponse);
          const recommendedCPU = getRecommendedCPU(vpaRecommendations, cpuResponse, resources.requests.cpu);
          const recommendedMemory = getRecommendedMemory(vpaRecommendations, memoryResponse, resources.requests.memory);
          
          console.log(`📋 Processing metrics for ${workload.name}:`, {
            currentCpuRequest: resources.requests.cpu,
            currentMemoryRequest: resources.requests.memory,
            cpuUsage: cpuUsage,
            memoryUsage: memoryUsage,
            recommendedCPU: recommendedCPU,
            recommendedMemory: recommendedMemory,
            vpaAvailable: vpaRecommendations.available,
            cpuResponseLength: cpuResponse?.length || 0,
            memoryResponseLength: memoryResponse?.length || 0
          });
          
          const processedMetrics = {
            name: workload.name,
            namespace: workload.namespace,
            type: actualWorkloadType || workload.type || 'Unknown',
            replicas: actualReplicas,
            cpuRequest: resources.requests.cpu,
            memoryRequest: resources.requests.memory,
            cpuLimit: resources.limits.cpu,
            memoryLimit: resources.limits.memory,
            cpuUsage: cpuUsage,
            memoryUsage: memoryUsage,
            recommendedCPU: recommendedCPU,
            recommendedMemory: recommendedMemory,
            efficiency: calculateEfficiency(cpuResponse, memoryResponse, resources),
            cost: calculateCost(resources, actualReplicas),
            potentialSavings: calculatePotentialSavingsWithVPA(vpaRecommendations, resources),
            status: 'running',
            recommendations: generateRecommendationsWithVPA(vpaRecommendations, cpuResponse, memoryResponse, resources),
            platform: 'gke',
            vpaEnabled: vpaRecommendations.available,
            // Add per-container VPA recommendations
            vpaDetails: vpaRecommendations.available ? {
              cpuPerContainer: vpaRecommendations.cpuPerContainer || {},
              memoryPerContainer: vpaRecommendations.memoryPerContainer || {},
              totalCpuRecommended: vpaRecommendations.cpu,
              totalMemoryRecommended: vpaRecommendations.memory
            } : null,
            // Add per-container resource requests (current usage)
            containerDetails: {
              cpuRequestsPerContainer: resourceRequests.cpuPerContainer || {},
              memoryRequestsPerContainer: resourceRequests.memoryPerContainer || {}
            }
          };
          
          metricsData.push(processedMetrics);
          
        } catch (workloadError) {
          console.error(`Error fetching metrics for workload ${workload.name}:`, workloadError);
          // Add the workload with error info so we can see what happened
          metricsData.push({
            name: workload.name,
            namespace: workload.namespace,
            type: workload.type || 'Unknown',
            error: workloadError.message,
            status: 'error'
          });
        }
      }
      
      res.json({ workloads: metricsData });
    } catch (error) {
      console.error('Error fetching metrics:', error);
      
      // Provide specific error messages based on error type
      if (error.code === 'ENOTFOUND') {
        return res.status(503).json({ 
          error: 'GCP service unavailable',
          details: 'Unable to connect to Google Cloud services. Please check your internet connection and credentials.'
        });
      }
      
      if (error.code === 'UNAUTHENTICATED') {
        return res.status(401).json({ 
          error: 'Authentication failed',
          details: 'Unable to authenticate with Google Cloud. Please check your Application Default Credentials.'
        });
      }
      
      if (error.code === 'PERMISSION_DENIED') {
        return res.status(403).json({ 
          error: 'Permission denied',
          details: 'Insufficient permissions to access the requested resources. Please check your IAM roles.'
        });
      }
      
      if (error.code === 'NOT_FOUND') {
        return res.status(404).json({ 
          error: 'Resource not found',
          details: 'The specified project, cluster, or resource could not be found.'
        });
      }
      
      res.status(500).json({ 
        error: 'Internal server error',
        details: 'An unexpected error occurred while fetching metrics. Please try again later.'
      });
    }
  } catch (error) {
    console.error('Unexpected error in metrics endpoint:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: 'An unexpected error occurred. Please try again later.'
    });
  }
});

// Helper functions for metrics processing
function calculateCurrentUsage(timeSeries) {
  if (!timeSeries || timeSeries.length === 0) return 0;
  
  const latestSeries = timeSeries[0];
  if (!latestSeries.points || latestSeries.points.length === 0) return 0;
  
  const latestPoint = latestSeries.points[0];
  return latestPoint.value?.doubleValue || 0;
}

// VPA-aware recommendation functions
function getRecommendedCPU(vpaRecommendations, cpuTimeSeries, currentRequest) {
  // Prefer VPA recommendations when available
  if (vpaRecommendations.available && vpaRecommendations.cpu !== null) {
    // VPA returns cores, convert to millicores
    const vpaCpuMillicores = Math.round(vpaRecommendations.cpu * 1000);
    // Round to nearest 10m for practical increments
    return Math.max(10, Math.ceil(vpaCpuMillicores / 10) * 10);
  }
  
  // Fall back to calculated recommendation if VPA not available
  return calculateRecommendation(cpuTimeSeries, 'cpu', currentRequest);
}

function getRecommendedMemory(vpaRecommendations, memoryTimeSeries, currentRequest) {
  // Prefer VPA recommendations when available
  if (vpaRecommendations.available && vpaRecommendations.memory !== null) {
    const vpaMemoryBytes = Math.round(vpaRecommendations.memory);
    // Round to nearest 16Mi for practical increments
    const mebibyte = 1024 * 1024;
    return Math.max(16 * mebibyte, Math.ceil(vpaMemoryBytes / (16 * mebibyte)) * (16 * mebibyte));
  }
  
  // Fall back to calculated recommendation if VPA not available
  return calculateRecommendation(memoryTimeSeries, 'memory', currentRequest);
}

function calculateRecommendation(timeSeries, metricType, currentRequest) {
  if (!timeSeries || timeSeries.length === 0) {
    // Return current request if no metrics available
    return currentRequest || (metricType === 'cpu' ? 10 : 16 * 1024 * 1024);
  }
  
  const values = [];
  timeSeries.forEach(series => {
    series.points?.forEach(point => {
      if (point.value?.doubleValue) {
        values.push(point.value.doubleValue);
      }
    });
  });
  
  if (values.length === 0) {
    return currentRequest || (metricType === 'cpu' ? 10 : 16 * 1024 * 1024);
  }
  
  // Calculate P90 for CPU, max for memory
  values.sort((a, b) => a - b);
  
  let recommendation;
  if (metricType === 'cpu') {
    const p90Index = Math.floor(values.length * 0.9);
    recommendation = values[p90Index] * 1.15; // Add 15% buffer
    // Convert from cores to millicores
    recommendation = recommendation * 1000;
  } else {
    recommendation = Math.max(...values) * 1.2; // Add 20% buffer
  }
  
  // Round to practical increments
  if (metricType === 'cpu') {
    // Round to nearest 10m
    return Math.max(10, Math.ceil(recommendation / 10) * 10);
  } else {
    // Round to nearest 16Mi
    const mebibyte = 1024 * 1024;
    return Math.max(16 * mebibyte, Math.ceil(recommendation / (16 * mebibyte)) * (16 * mebibyte));
  }
}


function calculateEfficiency(cpuSeries, memorySeries, resources) {
  const cpuUsage = calculateCurrentUsage(cpuSeries);
  const memoryUsage = calculateCurrentUsage(memorySeries);
  
  const cpuRequest = resources?.requests?.cpu || 100;
  const memoryRequest = resources?.requests?.memory || 128 * 1024 * 1024;
  
  // Calculate efficiency as (actual usage / requested) * 100
  const cpuEfficiency = cpuRequest > 0 ? Math.min(100, (cpuUsage * 1000 / cpuRequest) * 100) : 100;
  const memoryEfficiency = memoryRequest > 0 ? Math.min(100, (memoryUsage / memoryRequest) * 100) : 100;
  
  // Return average efficiency
  return Math.round((cpuEfficiency + memoryEfficiency) / 2);
}

function calculateCost(resources, replicas) {
  // GKE pricing (simplified)
  const cpuCostPerHour = 0.031611; // per vCPU per hour
  const memoryCostPerHour = 0.004237; // per GB per hour
  
  const cpuCores = (resources?.requests?.cpu || 100) / 1000;
  const memoryGB = (resources?.requests?.memory || 128 * 1024 * 1024) / (1024 * 1024 * 1024);
  
  const hourlyCost = (cpuCores * cpuCostPerHour + memoryGB * memoryCostPerHour) * replicas;
  const monthlyCost = hourlyCost * 24 * 30;
  
  return Math.round(monthlyCost * 100) / 100;
}

// VPA-aware cost calculation
function calculatePotentialSavingsWithVPA(vpaRecommendations, resources) {
  const currentCost = calculateCost(resources, 1);
  
  let optimizedResources;
  if (vpaRecommendations.available) {
    // Use VPA recommendations for more accurate cost projections
    optimizedResources = {
      requests: {
        cpu: vpaRecommendations.cpu ? Math.round(vpaRecommendations.cpu * 1000) : resources?.requests?.cpu || 100,
        memory: vpaRecommendations.memory ? Math.round(vpaRecommendations.memory) : resources?.requests?.memory || 128 * 1024 * 1024
      }
    };
  } else {
    // Fall back to basic calculation
    optimizedResources = {
      requests: {
        cpu: resources?.requests?.cpu || 100,
        memory: resources?.requests?.memory || 128 * 1024 * 1024
      }
    };
  }
  
  const optimizedCost = calculateCost(optimizedResources, 1);
  const savings = Math.max(0, currentCost - optimizedCost);
  
  return Math.round(savings * 100) / 100;
}

// VPA-aware recommendations with per-container details
function generateRecommendationsWithVPA(vpaRecommendations, cpuSeries, memorySeries, resources) {
  const recommendations = [];
  
  if (vpaRecommendations.available) {
    const currentCpuRequest = resources?.requests?.cpu || 100;
    const currentMemoryRequest = resources?.requests?.memory || 128 * 1024 * 1024;
    
    // Check if any ratio adjustments were made
    const hasRatioAdjustments = vpaRecommendations.ratioAdjustments?.total || 
                                Object.keys(vpaRecommendations.ratioAdjustments?.perContainer || {}).length > 0;
    
    // Calculate rounded per-container recommendations first
    let roundedCpuPerContainer = {};
    let roundedMemoryPerContainer = {};
    let totalRoundedCpuMillicores = 0;
    let totalRoundedMemoryBytes = 0;
    
    // Round CPU recommendations to nearest 10m
    if (vpaRecommendations.cpuPerContainer && Object.keys(vpaRecommendations.cpuPerContainer).length > 0) {
      Object.entries(vpaRecommendations.cpuPerContainer).forEach(([containerName, cpuCores]) => {
        const cpuMillicores = Math.round(cpuCores * 1000);
        const roundedCpuMillicores = Math.max(10, Math.ceil(cpuMillicores / 10) * 10);
        roundedCpuPerContainer[containerName] = roundedCpuMillicores;
        totalRoundedCpuMillicores += roundedCpuMillicores;
      });
    }
    
    // Round memory recommendations to nearest 16Mi
    if (vpaRecommendations.memoryPerContainer && Object.keys(vpaRecommendations.memoryPerContainer).length > 0) {
      const mebibyte = 1024 * 1024;
      Object.entries(vpaRecommendations.memoryPerContainer).forEach(([containerName, memoryBytes]) => {
        const roundedMemoryBytes = Math.max(16 * mebibyte, Math.ceil(memoryBytes / (16 * mebibyte)) * (16 * mebibyte));
        roundedMemoryPerContainer[containerName] = roundedMemoryBytes;
        totalRoundedMemoryBytes += roundedMemoryBytes;
      });
    }
    
    // Apply CPU:Memory ratio validation to total rounded values
    let finalTotalCpuMillicores = totalRoundedCpuMillicores;
    let finalTotalMemoryBytes = totalRoundedMemoryBytes;
    let ratioAdjustmentMade = false;
    
    if (totalRoundedCpuMillicores > 0 && totalRoundedMemoryBytes > 0) {
      const ratioValidation = validateAndAdjustCPUMemoryRatio(
        totalRoundedCpuMillicores / 1000, 
        totalRoundedMemoryBytes
      );
      
      if (ratioValidation.adjustmentReason) {
        ratioAdjustmentMade = true;
        finalTotalCpuMillicores = Math.round(ratioValidation.cpu * 1000);
        finalTotalMemoryBytes = ratioValidation.memory;
        
        // Round adjusted values back to increments
        finalTotalCpuMillicores = Math.max(10, Math.ceil(finalTotalCpuMillicores / 10) * 10);
        const mebibyte = 1024 * 1024;
        finalTotalMemoryBytes = Math.max(16 * mebibyte, Math.ceil(finalTotalMemoryBytes / (16 * mebibyte)) * (16 * mebibyte));
      }
    }
    
    // Display CPU recommendations
    if (Object.keys(roundedCpuPerContainer).length > 0) {
      recommendations.push('📊 CPU Recommendations by Container:');
      Object.entries(roundedCpuPerContainer).forEach(([containerName, cpuMillicores]) => {
        recommendations.push(`  • ${containerName}: ${cpuMillicores}m CPU`);
      });
      recommendations.push(`  → Total recommended: ${finalTotalCpuMillicores}m (current: ${currentCpuRequest}m)`);
    }
    
    // Display Memory recommendations
    if (Object.keys(roundedMemoryPerContainer).length > 0) {
      recommendations.push('💾 Memory Recommendations by Container:');
      const mebibyte = 1024 * 1024;
      Object.entries(roundedMemoryPerContainer).forEach(([containerName, memoryBytes]) => {
        const memoryMi = Math.round(memoryBytes / mebibyte);
        recommendations.push(`  • ${containerName}: ${memoryMi}Mi memory`);
      });
      const finalMemoryMi = Math.round(finalTotalMemoryBytes / mebibyte);
      const currentMemoryMi = Math.round(currentMemoryRequest / mebibyte);
      recommendations.push(`  → Total recommended: ${finalMemoryMi}Mi (current: ${currentMemoryMi}Mi)`);
    }
    
    // Legacy total recommendations (for backward compatibility)
    if (vpaRecommendations.cpu !== null) {
      const cpuDifference = ((finalTotalCpuMillicores - currentCpuRequest) / currentCpuRequest) * 100;
      
      if (Math.abs(cpuDifference) > 20) {
        const action = cpuDifference > 0 ? 'increase' : 'reduce';
        recommendations.push(`💡 Suggests ${action} total CPU by ${Math.round(Math.abs(cpuDifference))}%`);
      }
    }
    
    if (vpaRecommendations.memory !== null) {
      const memoryDifference = ((finalTotalMemoryBytes - currentMemoryRequest) / currentMemoryRequest) * 100;
      
      if (Math.abs(memoryDifference) > 20) {
        const action = memoryDifference > 0 ? 'increase' : 'reduce';
        recommendations.push(`💡 Suggests ${action} total memory by ${Math.round(Math.abs(memoryDifference))}%`);
      }
    }

    if (hasRatioAdjustments || ratioAdjustmentMade) {
      recommendations.push('⚖️  Note: CPU:Memory ratio validation applied (Between 1:1 and 1:6.5)');
    }
    
    if (vpaRecommendations.cpu === null && vpaRecommendations.memory === null) {
      recommendations.push('⏳ VPA recommendations not yet available - allow more time for VPA to collect data');
    }
  } else {
    // Fall back to usage-based recommendations when VPA is not available
    const cpuUsage = calculateCurrentUsage(cpuSeries);
    const memoryUsage = calculateCurrentUsage(memorySeries);
    
    const cpuRequest = resources?.requests?.cpu || 100;
    const memoryRequest = resources?.requests?.memory || 128 * 1024 * 1024;
    
    // CPU recommendations
    const cpuUtilization = cpuRequest > 0 ? (cpuUsage * 1000 / cpuRequest) : 0;
    if (cpuUtilization < 0.3) {
      recommendations.push('💡 Consider reducing CPU request - low utilization detected');
    } else if (cpuUtilization > 0.8) {
      recommendations.push('💡 Consider increasing CPU request - high utilization detected');
    }
    
    // Memory recommendations
    const memoryUtilization = memoryRequest > 0 ? (memoryUsage / memoryRequest) : 0;
    if (memoryUtilization < 0.3) {
      recommendations.push('💡 Consider reducing memory request - low utilization detected');
    } else if (memoryUtilization > 0.8) {
      recommendations.push('💡 Consider increasing memory request - high utilization detected');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('✅ Resources appear well optimized based on usage patterns');
    }
    
    recommendations.push('🔧 Enable VPA for ML-based per-container recommendations');
  }
  
  return recommendations;
}


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Basic error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(port, () => {
  console.log(`GCP Resource Portal Backend running on port ${port}`);
});