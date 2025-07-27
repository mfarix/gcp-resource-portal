import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { AlertTriangle, TrendingUp, DollarSign, Cpu, HardDrive, Zap, Download, RefreshCw, Cloud, Info, Server, Box, Bot, Lightbulb, CheckCircle, AlertCircle, XCircle } from 'lucide-react';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const GCPResourcePortal = () => {
  const [selectedProject, setSelectedProject] = useState(() => localStorage.getItem('gcp-portal-project') || '');
  const [selectedCluster, setSelectedCluster] = useState(() => localStorage.getItem('gcp-portal-cluster') || '');
  const [selectedNamespace, setSelectedNamespace] = useState(() => localStorage.getItem('gcp-portal-namespace') || '');
  const [selectedWorkload, setSelectedWorkload] = useState(() => localStorage.getItem('gcp-portal-workload') || '');
  const [selectedTimeRange, setSelectedTimeRange] = useState(() => localStorage.getItem('gcp-portal-timerange') || '1h');

  const [workloads, setWorkloads] = useState([]);
  const [metricsData, setMetricsData] = useState([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [error, setError] = useState(null);

  // API Functions

  const fetchMetrics = async () => {
    if (!selectedProject || !selectedCluster) return;
    
    try {
      setIsLoadingMetrics(true);
      const response = await fetch(`${API_BASE_URL}/api/metrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: selectedProject,
          clusterName: selectedCluster,
          namespace: selectedNamespace || null,
          workloadName: selectedWorkload || null,
          timeRange: parseInt(selectedTimeRange.replace('h', ''))
        })
      });
      
      if (!response.ok) throw new Error('Failed to fetch metrics');
      const data = await response.json();
      setMetricsData(data);
      setWorkloads(data.workloads || []);
      setLastUpdated(new Date());
    } catch (err) {
      setError('Failed to fetch metrics: ' + err.message);
    } finally {
      setIsLoadingMetrics(false);
    }
  };

  // Effects for localStorage persistence
  useEffect(() => {
    localStorage.setItem('gcp-portal-project', selectedProject);
  }, [selectedProject]);

  useEffect(() => {
    localStorage.setItem('gcp-portal-cluster', selectedCluster);
  }, [selectedCluster]);

  useEffect(() => {
    localStorage.setItem('gcp-portal-namespace', selectedNamespace);
  }, [selectedNamespace]);

  useEffect(() => {
    localStorage.setItem('gcp-portal-workload', selectedWorkload);
  }, [selectedWorkload]);

  useEffect(() => {
    localStorage.setItem('gcp-portal-timerange', selectedTimeRange);
  }, [selectedTimeRange]);

  // Mock data fallback for demonstration
  const mockWorkloads = [
    {
      name: 'web-frontend',
      namespace: 'production',
      region: 'us-central1',
      type: 'Deployment',
      replicas: 3,
      cpuRequest: 500,
      memoryRequest: 536870912,
      cpuUsage: 320,
      memoryUsage: 680,
      recommendedCPU: 400,
      recommendedMemory: 734003200,
      cpuRequestFormatted: '500m',
      memoryRequestFormatted: '512Mi',
      recommendedCPUFormatted: '400m',
      recommendedMemoryFormatted: '700Mi',
      cost: 145.50,
      potentialSavings: 25.00,
      efficiency: 78,
      status: 'running',
      recommendations: [
        '📊 CPU Recommendations by Container:',
        '  • nginx: 80m CPU',
        '  • app: 320m CPU',
        '  → Total recommended: 400m (current: 500m)',
        '💾 Memory Recommendations by Container:',
        '  • nginx: 150Mi memory',
        '  • app: 550Mi memory',
        '  → Total recommended: 700Mi (current: 512Mi)',
        '💡 Suggests reduce total CPU by 20%',
        '💡 Suggests increase total memory by 37%'
      ],
      platform: 'gke',
      containerDetails: {
        cpuRequestsPerContainer: {
          'nginx': 100,
          'app': 400
        },
        memoryRequestsPerContainer: {
          'nginx': 134217728,
          'app': 402653184
        },
        recommendations: {
          'nginx': {
            current: { cpu: 100, memory: 134217728, cpuFormatted: '100m', memoryFormatted: '128Mi' },
            recommended: { cpu: 80, memory: 157286400, cpuFormatted: '80m', memoryFormatted: '150Mi' },
            analysis: {
              status: 'over-resourced',
              recommendations: ['CPU over-provisioned: reduce by 20%', 'Memory under-provisioned: increase by 17%'],
              potentialSavings: 0.40,
              cpuDifferencePercent: -20,
              memoryDifferencePercent: 17
            }
          },
          'app': {
            current: { cpu: 400, memory: 402653184, cpuFormatted: '400m', memoryFormatted: '384Mi' },
            recommended: { cpu: 320, memory: 576716800, cpuFormatted: '320m', memoryFormatted: '550Mi' },
            analysis: {
              status: 'under-resourced',
              recommendations: ['CPU over-provisioned: reduce by 20%', 'Memory under-provisioned: increase by 43%'],
              potentialSavings: 1.60,
              cpuDifferencePercent: -20,
              memoryDifferencePercent: 43
            }
          }
        }
      }
    },
    {
      name: 'api-backend',
      namespace: 'production',
      region: 'us-central1',
      type: 'Deployment',
      replicas: 5,
      cpuRequest: 1000,
      memoryRequest: 1073741824,
      cpuUsage: 850,
      memoryUsage: 920,
      recommendedCPU: 900,
      recommendedMemory: 1048576000,
      cpuRequestFormatted: '1000m',
      memoryRequestFormatted: '1024Mi',
      recommendedCPUFormatted: '900m',
      recommendedMemoryFormatted: '1000Mi',
      cost: 312.75,
      potentialSavings: 45.00,
      efficiency: 92,
      status: 'running',
      recommendations: [
        '📊 CPU Recommendations by Container:',
        '  • api: 900m CPU',
        '  → Total recommended: 900m (current: 1000m)',
        '💾 Memory Recommendations by Container:',
        '  • api: 1000Mi memory',
        '  → Total recommended: 1000Mi (current: 1024Mi)',
        '💡 Suggests reduce total CPU by 10%',
        '💡 Well optimized workload with minor adjustments possible'
      ],
      platform: 'gke',
      containerDetails: {
        cpuRequestsPerContainer: {
          'api': 1000
        },
        memoryRequestsPerContainer: {
          'api': 1073741824
        },
        recommendations: {
          'api': {
            current: { cpu: 1000, memory: 1073741824, cpuFormatted: '1000m', memoryFormatted: '1024Mi' },
            recommended: { cpu: 900, memory: 1048576000, cpuFormatted: '900m', memoryFormatted: '1000Mi' },
            analysis: {
              status: 'optimal',
              recommendations: ['Well optimized workload'],
              potentialSavings: 2.00,
              cpuDifferencePercent: -10,
              memoryDifferencePercent: -2
            }
          }
        }
      }
    }
  ];

  const displayWorkloads = workloads.length > 0 ? workloads : mockWorkloads;
  const filteredWorkloads = displayWorkloads;
  
  const totalCost = filteredWorkloads.reduce((sum, w) => sum + (w.cost || 0), 0);
  const totalPotentialSavings = filteredWorkloads.reduce((sum, w) => sum + (w.potentialSavings || 0), 0);
  const avgEfficiency = filteredWorkloads.length > 0 
    ? filteredWorkloads.reduce((sum, w) => sum + (w.efficiency || 0), 0) / filteredWorkloads.length 
    : 0;
  const totalCPU = filteredWorkloads.reduce((sum, w) => sum + (w.cpuUsage || 0), 0);
  const totalMemory = filteredWorkloads.reduce((sum, w) => sum + (w.memoryUsage || 0), 0);
  const totalInstances = filteredWorkloads.reduce((sum, w) => sum + (w.replicas || 0), 0);

  const resourceData = filteredWorkloads.map(w => ({
    name: w.name,
    currentCPU: w.cpuRequest || 0,
    recommendedCPU: w.recommendedCPU || 0,
    currentMemory: w.memoryRequest || 0,
    recommendedMemory: w.recommendedMemory || 0,
    efficiency: w.efficiency || 0,
    cost: w.cost || 0,
    savings: w.potentialSavings || 0
  }));

  const costByLocation = filteredWorkloads.reduce((acc, w) => {
    const location = w.namespace || w.region || 'unknown';
    acc[location] = (acc[location] || 0) + (w.cost || 0);
    return acc;
  }, {});

  const costData = Object.entries(costByLocation).map(([name, value]) => ({ name, value }));

  const handleRefresh = () => {
    fetchMetrics();
  };

  const handleSubmit = () => {
    if (!selectedProject || !selectedCluster) {
      setError('Please enter both Project ID and Cluster Name to fetch metrics');
      return;
    }
    setError(null);
    fetchMetrics();
  };

  // Render functions
  const StatCard = ({ title, value, icon: Icon, change, changeType, unit = '' }) => (
    <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">
            {typeof value === 'number' ? value.toFixed(unit === '$' ? 2 : 0) : value}{unit}
          </p>
          {change && (
            <p className={`text-sm ${changeType === 'positive' ? 'text-green-600' : 'text-red-600'} flex items-center`}>
              <TrendingUp className="h-4 w-4 mr-1" />
              {change}
            </p>
          )}
        </div>
        <div className={`p-3 rounded-full ${changeType === 'positive' ? 'bg-green-100' : 'bg-blue-100'}`}>
          <Icon className={`h-6 w-6 ${changeType === 'positive' ? 'text-green-600' : 'text-blue-600'}`} />
        </div>
      </div>
    </div>
  );

  const AIRecommendations = () => {
    // Get the first workload to use for the personalized message
    const primaryWorkload = filteredWorkloads.length > 0 ? filteredWorkloads[0] : null;
    
    // Aggregate recommendations from all workloads
    const allRecommendations = filteredWorkloads.reduce((acc, workload) => {
      if (workload.recommendations && Array.isArray(workload.recommendations)) {
        acc.push(...workload.recommendations);
      }
      return acc;
    }, []);

    if (allRecommendations.length === 0) {
      return null;
    }

    // Categorize recommendations
    const cpuRecommendations = allRecommendations.filter(rec => rec.toLowerCase().includes('cpu'));
    const memoryRecommendations = allRecommendations.filter(rec => rec.toLowerCase().includes('memory'));
    const generalRecommendations = allRecommendations.filter(rec => 
      !rec.toLowerCase().includes('cpu') && !rec.toLowerCase().includes('memory')
    );

    return (
      <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 mb-6">
        <div className="flex items-center mb-4">
          <Bot className="h-6 w-6 text-purple-600 mr-3" />
          <h3 className="text-lg font-medium text-gray-900">Recommendations</h3>
          <span className="ml-2 px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded-full">Beta</span>
        </div>
        
        <div className="prose prose-gray max-w-none">
          <p className="text-gray-600 mb-4">
            {primaryWorkload ? (
              <>
                Based on my analysis of <span className="font-semibold text-gray-800">{primaryWorkload.name}</span>{' '}
                <span className="font-semibold text-gray-800">{primaryWorkload.type}</span>, I've identified several optimization opportunities 
                that could improve performance and reduce costs. Here are my key recommendations:
              </>
            ) : (
              'Based on my analysis of your Kubernetes workloads, I\'ve identified several optimization opportunities that could improve performance and reduce costs. Here are my key recommendations:'
            )}
          </p>
          
          {cpuRecommendations.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center mb-2">
                <Cpu className="h-4 w-4 text-blue-600 mr-2" />
                <h4 className="text-sm font-semibold text-gray-800">CPU Optimization</h4>
              </div>
              <div className="ml-6 space-y-1">
                {cpuRecommendations.slice(0, 3).map((rec, i) => (
                  <div key={i} className="flex items-start">
                    <Lightbulb className="h-3 w-3 text-yellow-500 mr-2 mt-1 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{rec}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {memoryRecommendations.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center mb-2">
                <HardDrive className="h-4 w-4 text-green-600 mr-2" />
                <h4 className="text-sm font-semibold text-gray-800">Memory Optimization</h4>
              </div>
              <div className="ml-6 space-y-1">
                {memoryRecommendations.slice(0, 3).map((rec, i) => (
                  <div key={i} className="flex items-start">
                    <Lightbulb className="h-3 w-3 text-yellow-500 mr-2 mt-1 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{rec}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {generalRecommendations.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center mb-2">
                <Zap className="h-4 w-4 text-purple-600 mr-2" />
                <h4 className="text-sm font-semibold text-gray-800">General Optimizations</h4>
              </div>
              <div className="ml-6 space-y-1">
                {generalRecommendations.slice(0, 3).map((rec, i) => (
                  <div key={i} className="flex items-start">
                    <Lightbulb className="h-3 w-3 text-yellow-500 mr-2 mt-1 flex-shrink-0" />
                    <span className="text-sm text-gray-700">{rec}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    );
  };

  const WorkloadTable = () => (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <Server className="h-5 w-5 mr-2" />
          Workload Details
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CPU Request</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Memory Request</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredWorkloads.map((workload, idx) => {
              const containers = workload.containerDetails || {};
              const containerRecommendations = containers.recommendations || {};
              const cpuPerContainer = containers.cpuRequestsPerContainer || {};
              const memoryPerContainer = containers.memoryRequestsPerContainer || {};
              
              const containerNames = Object.keys({
                ...cpuPerContainer,
                ...memoryPerContainer,
                ...containerRecommendations
              });

              return (
                <React.Fragment key={idx}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Box className="h-5 w-5 text-gray-400 mr-3" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">{workload.name}</div>
                          <div className="text-sm text-gray-500">{workload.namespace}</div>
                          {containerNames.length > 0 && (
                            <div className="text-xs text-blue-600">{containerNames.length} container{containerNames.length > 1 ? 's' : ''}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{workload.type}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div className="font-medium">{workload.cpuRequestFormatted || `${workload.cpuRequest || 0}m`}</div>
                      {workload.recommendedCPUFormatted && (
                        <div className="text-xs text-green-600 font-bold">{workload.recommendedCPUFormatted}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div className="font-medium">{workload.memoryRequestFormatted || `${Math.round((workload.memoryRequest || 0) / (1024 * 1024))}Mi`}</div>
                      {workload.recommendedMemoryFormatted && (
                        <div className="text-xs text-green-600 font-bold">{workload.recommendedMemoryFormatted}</div>
                      )}
                    </td>
                  </tr>
                  {containerNames.length > 0 && containerNames.map((containerName) => {
                    const containerRec = containerRecommendations[containerName];
                    const statusColor = containerRec?.analysis?.status === 'optimal' ? 'bg-green-100 text-green-800' :
                                      containerRec?.analysis?.status === 'over-resourced' ? 'bg-yellow-100 text-yellow-800' :
                                      containerRec?.analysis?.status === 'under-resourced' ? 'bg-red-100 text-red-800' :
                                      'bg-gray-100 text-gray-800';
                    
                    return (
                      <tr key={`${idx}-${containerName}`} className="bg-gray-50">
                        <td className="px-6 py-2 pl-16">
                          <div className="flex items-center">
                            <div className="h-3 w-3 bg-blue-400 rounded mr-2"></div>
                            <div className="text-sm text-gray-700">{containerName}</div>
                            {containerRec?.analysis?.status && (
                              <span className={`ml-2 px-2 py-1 text-xs rounded-full ${statusColor}`}>
                                {containerRec.analysis.status.replace('-', ' ')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-2 text-xs text-gray-500">Container</td>
                        <td className="px-6 py-2 text-xs text-gray-700">
                          {containerRec?.current?.cpuFormatted || cpuPerContainer[containerName] ? `${cpuPerContainer[containerName]}m` : '-'}
                          {containerRec?.recommended?.cpuFormatted && (
                            <div className="flex items-center">
                              <span className="text-xs text-green-600 font-bold">{containerRec.recommended.cpuFormatted}</span>
                              {containerRec.analysis?.cpuDifferencePercent && (
                                <span className={`ml-1 text-xs ${containerRec.analysis.cpuDifferencePercent > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                  ({containerRec.analysis.cpuDifferencePercent > 0 ? '+' : ''}{containerRec.analysis.cpuDifferencePercent}%)
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-2 text-xs text-gray-700">
                          {containerRec?.current?.memoryFormatted || memoryPerContainer[containerName] ? `${Math.round(memoryPerContainer[containerName] / (1024 * 1024))}Mi` : '-'}
                          {containerRec?.recommended?.memoryFormatted && (
                            <div className="flex items-center">
                              <span className="text-xs text-green-600 font-bold">{containerRec.recommended.memoryFormatted}</span>
                              {containerRec.analysis?.memoryDifferencePercent && (
                                <span className={`ml-1 text-xs ${containerRec.analysis.memoryDifferencePercent > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                  ({containerRec.analysis.memoryDifferencePercent > 0 ? '+' : ''}{containerRec.analysis.memoryDifferencePercent}%)
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Cloud className="h-8 w-8 text-blue-600 mr-3" />
              <h1 className="text-2xl font-bold text-gray-900">GCP Resource Optimization Portal</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={handleRefresh}
                disabled={isLoadingMetrics}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingMetrics ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <span className="text-sm text-gray-500">
                Last updated: {lastUpdated.toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Project ID *</label>
              <input
                type="text"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                placeholder="Enter project ID"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Cluster Name *</label>
              <input
                type="text"
                value={selectedCluster}
                onChange={(e) => setSelectedCluster(e.target.value)}
                placeholder="Enter cluster name"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Namespace</label>
              <input
                type="text"
                value={selectedNamespace}
                onChange={(e) => setSelectedNamespace(e.target.value)}
                placeholder="Enter namespace"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Workload Name</label>
              <input
                type="text"
                value={selectedWorkload}
                onChange={(e) => setSelectedWorkload(e.target.value)}
                placeholder="Enter workload name"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Time Range</label>
              <select
                value={selectedTimeRange}
                onChange={(e) => setSelectedTimeRange(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="1h">Last 1 Hour</option>
                <option value="6h">Last 6 Hours</option>
                <option value="24h">Last 24 Hours</option>
                <option value="7d">Last 7 Days</option>
              </select>
            </div>

            <div className="flex justify-center">
              <button
                onClick={handleSubmit}
                disabled={isLoadingMetrics || !selectedProject || !selectedCluster}
                className="w-[42px] h-[42px] inline-flex items-center justify-center border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                title={isLoadingMetrics ? "Loading..." : "Get Workload Metrics"}
              >
                {isLoadingMetrics ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Server className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
            <div className="flex">
              <AlertTriangle className="h-5 w-5 text-red-400 mr-2" />
              <div className="text-sm text-red-700">{error}</div>
            </div>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <StatCard
            title="Total Monthly Cost"
            value={totalCost}
            icon={DollarSign}
            unit="$"
          />
          <StatCard
            title="Potential Savings"
            value={totalPotentialSavings}
            icon={TrendingUp}
            unit="$"
          />
          <StatCard
            title="Average Efficiency"
            value={avgEfficiency}
            icon={Zap}
            unit="%"
          />
          <StatCard
            title="Total Replicas"
            value={totalInstances}
            icon={Server}
          />
        </div>


        {/* AI Recommendations */}
        <AIRecommendations />

        {/* Workloads Table */}
        <WorkloadTable />
      </div>
    </div>
  );
};

export default GCPResourcePortal;