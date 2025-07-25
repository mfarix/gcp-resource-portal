import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { AlertTriangle, TrendingUp, DollarSign, Cpu, HardDrive, Zap, Download, RefreshCw, Cloud, Info, Server, Box } from 'lucide-react';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const GCPResourcePortal = () => {
  const [selectedPlatform, setSelectedPlatform] = useState('gke');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedCluster, setSelectedCluster] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState('all');
  const [selectedService, setSelectedService] = useState('all');
  const [selectedWorkload, setSelectedWorkload] = useState('all');
  const [selectedTimeRange, setSelectedTimeRange] = useState('1h');
  const [activeTab, setActiveTab] = useState('overview');

  const [projects, setProjects] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [regions, setRegions] = useState([]);
  const [namespaces, setNamespaces] = useState([]);
  const [services, setServices] = useState([]);
  const [workloads, setWorkloads] = useState([]);
  const [metricsData, setMetricsData] = useState([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [error, setError] = useState(null);

  // API Functions
  const fetchProjects = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/projects`);
      if (!response.ok) throw new Error('Failed to fetch projects');
      const data = await response.json();
      setProjects(data);
      if (data.length > 0 && !selectedProject) {
        setSelectedProject(data[0].id);
      }
    } catch (err) {
      setError('Failed to fetch projects: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchClusters = async (projectId) => {
    if (!projectId) return;
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/clusters`);
      if (!response.ok) throw new Error('Failed to fetch clusters');
      const data = await response.json();
      setClusters(data);
      if (data.length > 0 && !selectedCluster) {
        setSelectedCluster(data[0].name);
      }
    } catch (err) {
      setError('Failed to fetch clusters: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchNamespaces = async (projectId, clusterName) => {
    if (!projectId || !clusterName) return;
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/clusters/${clusterName}/namespaces`);
      if (!response.ok) throw new Error('Failed to fetch namespaces');
      const data = await response.json();
      setNamespaces(data);
    } catch (err) {
      setError('Failed to fetch namespaces: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchWorkloads = async (projectId, clusterName, namespace) => {
    if (!projectId || !clusterName) return;
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/clusters/${clusterName}/namespaces/${namespace}/workloads`);
      if (!response.ok) throw new Error('Failed to fetch workloads');
      const data = await response.json();
      setWorkloads(data);
    } catch (err) {
      setError('Failed to fetch workloads: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMetrics = async () => {
    if (!selectedProject || !selectedCluster || workloads.length === 0) return;
    
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
          namespace: selectedNamespace === 'all' ? null : selectedNamespace,
          workloads: workloads.map(w => w.name),
          timeRange: parseInt(selectedTimeRange.replace('h', ''))
        })
      });
      
      if (!response.ok) throw new Error('Failed to fetch metrics');
      const data = await response.json();
      setMetricsData(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError('Failed to fetch metrics: ' + err.message);
    } finally {
      setIsLoadingMetrics(false);
    }
  };

  // Effects
  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetchClusters(selectedProject);
    }
  }, [selectedProject]);

  useEffect(() => {
    if (selectedProject && selectedCluster) {
      fetchNamespaces(selectedProject, selectedCluster);
    }
  }, [selectedProject, selectedCluster]);

  useEffect(() => {
    if (selectedProject && selectedCluster && selectedNamespace) {
      fetchWorkloads(selectedProject, selectedCluster, selectedNamespace);
    }
  }, [selectedProject, selectedCluster, selectedNamespace]);

  useEffect(() => {
    if (workloads.length > 0) {
      fetchMetrics();
    }
  }, [workloads, selectedTimeRange]);

  // Mock data fallback for demonstration
  const mockWorkloads = [
    {
      name: 'web-frontend',
      namespace: 'production',
      region: 'us-central1',
      type: selectedPlatform === 'gke' ? 'Deployment' : 'Cloud Run Service',
      replicas: selectedPlatform === 'gke' ? 3 : null,
      instances: selectedPlatform === 'cloud-run' ? 2 : null,
      cpuRequest: 500,
      memoryRequest: 512,
      cpuUsage: 320,
      memoryUsage: 680,
      recommendedCPU: 400,
      recommendedMemory: 700,
      cost: 145.50,
      potentialSavings: 25.00,
      efficiency: 78,
      status: 'running',
      recommendations: ['Reduce CPU limit', 'Increase memory request'],
      platform: selectedPlatform
    },
    {
      name: 'api-backend',
      namespace: 'production',
      region: 'us-central1',
      type: selectedPlatform === 'gke' ? 'Deployment' : 'Cloud Run Service',
      replicas: selectedPlatform === 'gke' ? 5 : null,
      instances: selectedPlatform === 'cloud-run' ? 3 : null,
      cpuRequest: 1000,
      memoryRequest: 1024,
      cpuUsage: 850,
      memoryUsage: 920,
      recommendedCPU: 900,
      recommendedMemory: 1000,
      cost: 312.75,
      potentialSavings: 45.00,
      efficiency: 92,
      status: 'running',
      recommendations: ['Well optimized'],
      platform: selectedPlatform
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
  const totalInstances = filteredWorkloads.reduce((sum, w) => sum + (w.replicas || w.instances || 0), 0);

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

  const WorkloadTable = () => (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 flex items-center">
          <Server className="h-5 w-5 mr-2" />
          {selectedPlatform === 'gke' ? 'Kubernetes Workloads' : 'Cloud Run Services'}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                {selectedPlatform === 'gke' ? 'Replicas' : 'Instances'}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CPU Usage</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Memory Usage</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Efficiency</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredWorkloads.map((workload, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <Box className="h-5 w-5 text-gray-400 mr-3" />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{workload.name}</div>
                      <div className="text-sm text-gray-500">{workload.namespace}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{workload.type}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {workload.replicas || workload.instances || 0}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {workload.cpuUsage || 0}m / {workload.cpuRequest || 0}m
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {workload.memoryUsage || 0}Mi / {workload.memoryRequest || 0}Mi
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-1 bg-gray-200 rounded-full h-2 mr-2">
                      <div 
                        className={`h-2 rounded-full ${
                          (workload.efficiency || 0) >= 80 ? 'bg-green-500' : 
                          (workload.efficiency || 0) >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${workload.efficiency || 0}%` }}
                      ></div>
                    </div>
                    <span className="text-sm text-gray-900">{workload.efficiency || 0}%</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${(workload.cost || 0).toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <button className="text-blue-600 hover:text-blue-900 mr-3">View Details</button>
                  <button className="text-green-600 hover:text-green-900">Optimize</button>
                </td>
              </tr>
            ))}
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
              <h1 className="text-2xl font-bold text-gray-900">GCP Resource Portal</h1>
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
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
              <select
                value={selectedPlatform}
                onChange={(e) => setSelectedPlatform(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="gke">Google Kubernetes Engine</option>
                <option value="cloud-run">Cloud Run</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Project</label>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              >
                <option value="">Select Project</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>

            {selectedPlatform === 'gke' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cluster</label>
                <select
                  value={selectedCluster}
                  onChange={(e) => setSelectedCluster(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isLoading || !selectedProject}
                >
                  <option value="">Select Cluster</option>
                  {clusters.map(cluster => (
                    <option key={cluster.name} value={cluster.name}>{cluster.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {selectedPlatform === 'gke' ? 'Namespace' : 'Region'}
              </label>
              <select
                value={selectedNamespace}
                onChange={(e) => setSelectedNamespace(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              >
                <option value="all">All {selectedPlatform === 'gke' ? 'Namespaces' : 'Regions'}</option>
                {namespaces.map(ns => (
                  <option key={ns.name} value={ns.name}>{ns.name}</option>
                ))}
              </select>
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
            change="+12% from last month"
            changeType="negative"
          />
          <StatCard
            title="Potential Savings"
            value={totalPotentialSavings}
            icon={TrendingUp}
            unit="$"
            change="23% optimization opportunity"
            changeType="positive"
          />
          <StatCard
            title="Average Efficiency"
            value={avgEfficiency}
            icon={Zap}
            unit="%"
            change="+5% from last week"
            changeType="positive"
          />
          <StatCard
            title={selectedPlatform === 'gke' ? 'Total Pods' : 'Total Instances'}
            value={totalInstances}
            icon={Server}
            change="2 new this week"
            changeType="neutral"
          />
        </div>

        {/* Charts and Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Resource Usage Chart */}
          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <Cpu className="h-5 w-5 mr-2" />
              Resource Usage vs Recommendations
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={resourceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="currentCPU" fill="#3B82F6" name="Current CPU (m)" />
                <Bar dataKey="recommendedCPU" fill="#10B981" name="Recommended CPU (m)" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Cost Distribution Chart */}
          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <DollarSign className="h-5 w-5 mr-2" />
              Cost Distribution by {selectedPlatform === 'gke' ? 'Namespace' : 'Region'}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={costData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {costData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'][index % 5]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`$${value.toFixed(2)}`, 'Cost']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Workloads Table */}
        <WorkloadTable />
      </div>
    </div>
  );
};

export default GCPResourcePortal;