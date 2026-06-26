import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Trophy, Award, Crown, Medal, Users, TrendingUp, Download, ChevronRight, Search, Star, Calendar, Zap, HardDrive, BadgeCheck 
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { useBatches } from '@/context/BatchContext';
import CustomSelect from '@/components/CustomSelect';
import MorphLoader from '@/components/MorphLoader';

export default function LeaderboardPage() {
  const { user } = useAuth();
  const { batches, fetchBatches } = useBatches();

  // Role and context
  const isTrainee = user?.role === 'TRAINEE';

  // Common States
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'batch' | 'global'>('batch');
  const [leaderboardData, setLeaderboardData] = useState<any[]>([]);
  const [globalData, setGlobalData] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  // Trainee Specific States
  const [traineeCandidate, setTraineeCandidate] = useState<any>(null);
  const [traineeRankInfo, setTraineeRankInfo] = useState<any>(null);
  const [traineeBatchDetails, setTraineeBatchDetails] = useState<any>(null);

  // Admin/Trainer Specific States
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [selectedBatchName, setSelectedBatchName] = useState<string>('');

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, selectedBatchId]);

  // Fetch initial configuration
  useEffect(() => {
    const initPage = async () => {
      try {
        setLoading(true);
        if (isTrainee) {
          // Trainee context
          const candRes = await api.get('/users/me/candidates');
          const candidatesList = candRes.data || [];
          if (candidatesList.length > 0) {
            const stored = localStorage.getItem('active_trainee_batch_id');
            let selectedCand = candidatesList[0];
            const isAll = stored === 'ALL';
            if (stored && !isAll) {
              const match = candidatesList.find((c: any) => c.batchId === stored);
              if (match) {
                selectedCand = match;
              } else {
                localStorage.setItem('active_trainee_batch_id', candidatesList[0].batchId);
              }
            } else if (!stored) {
              localStorage.setItem('active_trainee_batch_id', candidatesList[0].batchId);
            }
            setTraineeCandidate(selectedCand);

            const batchId = selectedCand.batchId;
            const candidateId = selectedCand.id;

            // Load standings in parallel
            const [rankRes, toppersRes, globalRes, batchRes] = await Promise.allSettled([
              api.get(`/report/rank/candidate/${candidateId}/batch/${batchId}`),
              api.get(`/report/toppers/${batchId}`),
              api.get('/report/toppers/all/leaderboard', { params: { limit: 15 } }),
              api.get(`/batch/${batchId}`)
            ]);

            if (rankRes.status === 'fulfilled') {
              setTraineeRankInfo(rankRes.value.data);
            }
            if (toppersRes.status === 'fulfilled') {
              setLeaderboardData(toppersRes.value.data?.toppers || []);
            }
            if (globalRes.status === 'fulfilled') {
              setGlobalData(globalRes.value.data || []);
            }
            if (batchRes.status === 'fulfilled') {
              setTraineeBatchDetails(batchRes.value.data);
            }
          }
        } else {
          // Admin/Trainer context
          await fetchBatches();
        }
      } catch (err) {
        console.error('Failed to initialize leaderboard:', err);
        toast.error('Could not load leaderboard standings.');
      } finally {
        setLoading(false);
      }
    };
    initPage();
  }, [user]);

  // Handle batch selection change for Admin/Trainer
  useEffect(() => {
    if (isTrainee || batches.length === 0) return;
    
    // Pick the first batch automatically if none is selected
    if (!selectedBatchId) {
      setSelectedBatchId(batches[0]._id);
      setSelectedBatchName(batches[0].batchName);
      return;
    }

    const loadBatchLeaderboard = async () => {
      try {
        setLoading(true);
        const [toppersRes, globalRes] = await Promise.allSettled([
          api.get(`/report/toppers/${selectedBatchId}`),
          api.get('/report/toppers/all/leaderboard', { params: { limit: 15 } })
        ]);

        if (toppersRes.status === 'fulfilled') {
          setLeaderboardData(toppersRes.value.data?.toppers || []);
        } else {
          setLeaderboardData([]);
        }

        if (globalRes.status === 'fulfilled') {
          setGlobalData(globalRes.value.data || []);
        }
      } catch (err) {
        console.error('Failed to load batch leaderboard:', err);
        toast.error('Failed to load standings for the selected batch.');
      } finally {
        setLoading(false);
      }
    };

    loadBatchLeaderboard();
  }, [selectedBatchId, batches]);

  const handleBatchChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const batchId = e.target.value;
    setSelectedBatchId(batchId);
    const match = batches.find(b => b._id === batchId);
    if (match) setSelectedBatchName(match.batchName);
  };

  const handleExportExcel = async () => {
    const batchId = isTrainee ? traineeCandidate?.batchId : selectedBatchId;
    if (!batchId) {
      toast.error('No active batch selected for export.');
      return;
    }

    const toastId = toast.loading('Compiling cohort rankings...');
    try {
      const response = await api.get('/report/toppers/export', {
        params: { batch_ids: batchId, limit: 100 },
        responseType: 'blob'
      });
      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = `Batch_Toppers_Leaderboard.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Leaderboard exported successfully!', { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate export report.', { id: toastId });
    }
  };

  // Active batch and details
  const activeBatchId = isTrainee ? traineeCandidate?.batchId : selectedBatchId;
  const activeBatch = isTrainee 
    ? traineeBatchDetails 
    : batches.find(b => b._id === activeBatchId || b.batchId === activeBatchId);

  // Determine current active rendering dataset (combined view sorted by performance score)
  const activeData = useMemo(() => {
    return activeTab === 'batch' ? [...leaderboardData] : [...globalData];
  }, [activeTab, leaderboardData, globalData]);

  const hasStandingsData = useMemo(() => {
    if (activeData.length === 0) return false;
    return activeData.some(row => {
      const overall = parseFloat(row.overallScore);
      const assessment = parseFloat(row.assessmentScore);
      const bytes = parseInt(row.bytesTotal);
      const bits = parseInt(row.bitsAccumulated);
      return (
        (!isNaN(overall) && overall > 0) ||
        (!isNaN(assessment) && assessment > 0) ||
        (!isNaN(bytes) && bytes > 0) ||
        (!isNaN(bits) && bits > 0)
      );
    });
  }, [activeData]);

  const totalRecords = activeData.length;
  const totalPages = Math.ceil(totalRecords / 10) || 1;
  const paginatedActiveData = useMemo(() => {
    const startIndex = (currentPage - 1) * 10;
    return activeData.slice(startIndex, startIndex + 10);
  }, [activeData, currentPage]);

  // Podium Positions Calculation
  const firstPlace = activeData[0] || null;
  const secondPlace = activeData[1] || null;
  const thirdPlace = activeData[2] || null;
  const listData = activeData.slice(3);

  // Helper to format scores safely
  const formatScore = (val: any) => {
    if (val === undefined || val === null) return '0.0%';
    const floatVal = parseFloat(val);
    if (isNaN(floatVal)) return '0.0%';
    if (floatVal <= 1.0) return `${(floatVal * 100).toFixed(1)}%`;
    return `${floatVal.toFixed(1)}%`;
  };

  // Helper to format gamification podium score
  const formatGamScore = (row: any) => {
    const bytes = row?.bytesTotal || 0;
    const bits = row?.bitsAccumulated || 0;
    return `${bytes}B · ${bits}b`;
  };

  const formatAttendance = (val: any) => {
    if (val === undefined || val === null) return '0.0%';
    const floatVal = parseFloat(val);
    if (isNaN(floatVal)) return '0.0%';
    // Attendance in db could be stored as fraction (e.g. 0.95) or raw percentage (e.g. 95.0)
    if (floatVal <= 1.0) return `${(floatVal * 100).toFixed(1)}%`;
    return `${floatVal.toFixed(1)}%`;
  };

  if (loading && activeData.length === 0) {
    return <MorphLoader minHeight="60vh" text="Assembling leaderboard standings..." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }} className="fade-in">
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Trophy size={28} color="var(--yellow)" style={{ filter: 'drop-shadow(0 0 8px var(--yellow-glow))' }} />
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Leaderboard</h1>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}>
              {isTrainee ? 'Compete with your peers and push your potential' : 'Monitor performance across cohorts'}
            </p>
            {isTrainee && activeBatch && activeTab === 'batch' && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Calendar size={13} />
                <span>Cohort: <strong>{activeBatch.batchName}</strong></span>
                <span>|</span>
                <span>
                  Duration: {new Date(activeBatch.startDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })} - {new Date(activeBatch.endDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 8, background: 'rgba(255, 255, 255, 0.03)', padding: 4, borderRadius: 12, border: '1px solid var(--border-color)' }}>
          <button
            onClick={() => setActiveTab('batch')}
            className="btn-secondary"
            style={{
              padding: '8px 16px', fontSize: 13, borderRadius: 10, border: 'none',
              background: activeTab === 'batch' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'batch' ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: activeTab === 'batch' ? 'var(--shadow-card)' : 'none',
              fontWeight: 700
            }}
          >
            {isTrainee ? 'My Batch' : 'Batch Standing'}
          </button>
          <button
            onClick={() => setActiveTab('global')}
            className="btn-secondary"
            style={{
              padding: '8px 16px', fontSize: 13, borderRadius: 10, border: 'none',
              background: activeTab === 'global' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'global' ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: activeTab === 'global' ? 'var(--shadow-card)' : 'none',
              fontWeight: 700
            }}
          >
            Global Champions
          </button>
        </div>

      </div>

      {/* FILTER & ACTIONS BAR (Only for Trainer/Admin/Coordinator) */}
      {!isTrainee && (
        <div className="card card-static" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Select Cohort:</span>
              <CustomSelect
                value={selectedBatchId}
                onChange={(val) => {
                  setSelectedBatchId(val);
                  const match = batches.find(b => b._id === val);
                  if (match) setSelectedBatchName(match.batchName);
                }}
                options={batches.map(b => ({
                  value: b._id,
                  label: b.batchName
                }))}
                style={{ minWidth: 200 }}
              />
            </div>
            {activeBatch && activeTab === 'batch' && (
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={14} color="var(--powder-blue)" />
                <span>
                  Duration: <strong>{new Date(activeBatch.startDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</strong> to <strong>{new Date(activeBatch.endDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</strong>
                </span>
              </span>
            )}
          </div>

          <button 
            onClick={handleExportExcel}
            className="btn-secondary animate-pulse"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', fontSize: 13 }}
          >
            <Download size={15} />
            <span>Export Leaderboard</span>
          </button>
        </div>
      )}

      {/* TRAINEE SUMMARY HERO */}
      {isTrainee && traineeRankInfo && activeTab === 'batch' && hasStandingsData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {/* Card 1: Standing */}
          <div className="card card-glow-orange card-rank" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="rank-label" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>Your Current Rank</span>
              <Award size={16} color="var(--pale-orange)" />
            </div>
            <h3 className="rank-value" style={{ fontSize: 28, fontWeight: 800, marginTop: 8 }}>
              {traineeRankInfo.rank !== -1 ? `#${traineeRankInfo.rank}` : 'N/A'}
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Out of {traineeRankInfo.totalCandidates} cohort peers
            </span>
          </div>

          {/* Card 2: Percentile */}
          <div className="card card-glow-blue" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--powder-blue)', fontWeight: 600, textTransform: 'uppercase' }}>Percentile Bracket</span>
              <TrendingUp size={16} color="var(--powder-blue)" />
            </div>
            <h3 style={{ fontSize: 28, fontWeight: 800, color: 'var(--powder-blue)', marginTop: 8 }}>
              {traineeRankInfo.percentile}%
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Better than {traineeRankInfo.percentile}% of class
            </span>
          </div>

          {/* Card 3: Phase Score */}
          <div className="card card-glow-yellow" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--yellow)', fontWeight: 600, textTransform: 'uppercase' }}>Weighted Average</span>
              <Star size={16} color="var(--yellow)" />
            </div>
            <h3 style={{ fontSize: 28, fontWeight: 800, color: 'var(--yellow)', marginTop: 8 }}>
              {formatScore(traineeRankInfo.score)}
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Option A Performance Index
            </span>
          </div>
        </div>
      )}

      {/* NO PERFORMANCE DATA PLACEHOLDER */}
      {!hasStandingsData ? (
        <div className="card card-glow-orange" style={{ padding: 64, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <Trophy size={48} color="var(--text-muted)" />
          <h3 style={{ fontSize: 18, color: 'var(--text-primary)', fontWeight: 700 }}>No Performance Records</h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: 450, fontSize: 14 }}>
            Rankings will appear once report cards or assessments are logged for this cohort. Keep working on targets to see your standing!
          </p>
        </div>
      ) : (
        <>
          {/* PODIUM DISPLAY */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-end',
            gap: 20,
            marginTop: 24,
            padding: '20px 0',
            flexWrap: 'wrap'
          }}>
            {/* 2nd Place (Silver) */}
            {secondPlace && (
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 150 }}
              >
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <div style={{
                    width: 60, height: 60, borderRadius: '50%', background: 'var(--bg-card)',
                    border: '3px solid var(--powder-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', boxShadow: '0 0 15px var(--powder-blue-glow)'
                  }}>
                    {secondPlace.fullName ? secondPlace.fullName.charAt(0) : '2'}
                  </div>
                  <div style={{
                    position: 'absolute', top: -14, right: -4, background: 'var(--powder-blue)',
                    width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 10px var(--powder-blue-glow)', color: '#121824'
                  }}>
                    <Star size={13} strokeWidth={3} fill="#121824" />
                  </div>
                </div>
                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
                    {secondPlace.fullName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--powder-blue)', fontWeight: 800 }}>
                    {formatScore(secondPlace.overallScore)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center' }}>
                    <Zap size={11} color="var(--powder-blue)" fill="var(--powder-blue)" />
                    <span>{formatGamScore(secondPlace)}</span>
                  </div>
                </div>
                {/* Silver Pedestal */}
                <div style={{
                  width: '100%', height: 110,
                  background: 'linear-gradient(180deg, rgba(112, 214, 255, 0.15) 0%, rgba(112, 214, 255, 0.02) 100%)',
                  border: '1px solid var(--powder-blue)',
                  borderBottom: 'none',
                  borderRadius: '16px 16px 0 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 -4px 15px var(--powder-blue-glow)'
                }}>
                  <span style={{ fontSize: 32, fontWeight: 900, color: 'var(--powder-blue)', opacity: 0.8 }}>#2</span>
                </div>
              </motion.div>
            )}

            {/* 1st Place (Gold) */}
            {firstPlace && (
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 170 }}
              >
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: '50%', background: 'var(--bg-card)',
                    border: '3px solid var(--yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 22, color: 'var(--text-primary)', boxShadow: '0 0 20px var(--yellow-glow)'
                  }}>
                    {firstPlace.fullName ? firstPlace.fullName.charAt(0) : '1'}
                  </div>
                  <div style={{
                    position: 'absolute', top: -16, right: -4, background: 'var(--yellow)',
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 15px var(--yellow-glow)', color: '#121824'
                  }}>
                    <Crown size={15} strokeWidth={2.5} fill="#121824" />
                  </div>
                </div>
                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 950, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
                    {firstPlace.fullName}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--yellow)', fontWeight: 800 }}>
                    {formatScore(firstPlace.overallScore)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center' }}>
                    <Zap size={11} color="var(--yellow)" fill="var(--yellow)" />
                    <span>{formatGamScore(firstPlace)}</span>
                  </div>
                </div>
                {/* Gold Pedestal */}
                <div style={{
                  width: '100%', height: 140,
                  background: 'linear-gradient(180deg, rgba(255, 208, 0, 0.2) 0%, rgba(255, 208, 0, 0.02) 100%)',
                  border: '1.5px solid var(--yellow)',
                  borderBottom: 'none',
                  borderRadius: '20px 20px 0 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 -4px 20px var(--yellow-glow)'
                }}>
                  <span style={{ fontSize: 44, fontWeight: 900, color: 'var(--yellow)', opacity: 0.9 }}>#1</span>
                </div>
              </motion.div>
            )}

            {/* 3rd Place (Bronze) */}
            {thirdPlace && (
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 140 }}
              >
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%', background: 'var(--bg-card)',
                    border: '3px solid var(--pale-orange)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 16, color: 'var(--text-primary)', boxShadow: '0 0 12px var(--pale-orange-glow)'
                  }}>
                    {thirdPlace.fullName ? thirdPlace.fullName.charAt(0) : '3'}
                  </div>
                  <div style={{
                    position: 'absolute', top: -12, right: -4, background: 'var(--pale-orange)',
                    width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 8px var(--pale-orange-glow)', color: '#121824'
                  }}>
                    <Medal size={12} strokeWidth={3} fill="#121824" />
                  </div>
                </div>
                <div style={{ textAlign: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }}>
                    {thirdPlace.fullName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--pale-orange)', fontWeight: 800 }}>
                    {formatScore(thirdPlace.overallScore)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center' }}>
                    <Zap size={11} color="var(--pale-orange)" fill="var(--pale-orange)" />
                    <span>{formatGamScore(thirdPlace)}</span>
                  </div>
                </div>
                {/* Bronze Pedestal */}
                <div style={{
                  width: '100%', height: 80,
                  background: 'linear-gradient(180deg, rgba(255, 160, 89, 0.12) 0%, rgba(255, 160, 89, 0.02) 100%)',
                  border: '1px solid var(--pale-orange)',
                  borderBottom: 'none',
                  borderRadius: '14px 14px 0 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 -4px 12px var(--pale-orange-glow)'
                }}>
                  <span style={{ fontSize: 26, fontWeight: 900, color: 'var(--pale-orange)', opacity: 0.8 }}>#3</span>
                </div>
              </motion.div>
            )}
          </div>

          {/* STANDINGS TABLE CARD */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Users size={18} color="var(--powder-blue)" />
                {activeTab === 'batch' ? 'Trainee Standings' : 'Global Top Performers'}
              </h3>
              <span style={{ fontSize: 12, background: 'var(--powder-blue-glow)', color: 'var(--text-primary)', padding: '4px 10px', borderRadius: 12, fontWeight: 700 }}>
                {activeData.length} records computed
              </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 600 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.015)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', width: 80 }}>Rank</th>
                    <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Trainee</th>
                    {activeTab === 'global' && (
                      <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Batch</th>
                    )}
                    <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Option A Score</th>
                    <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>BNB Points</th>
                    <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Assessment Avg</th>
                    <th style={{ padding: '16px 24px', fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', textAlign: 'center' }}>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedActiveData.map((row, index) => {
                    const rank = (currentPage - 1) * 10 + index + 1;
                    const isSelf = isTrainee && traineeCandidate && (row._id === traineeCandidate.id || row.email?.trim().toLowerCase() === user?.email?.trim().toLowerCase());

                    return (
                      <tr 
                        key={row._id || index}
                        style={{ 
                          borderBottom: '1px solid var(--border-color)',
                          background: isSelf 
                            ? 'rgba(112, 214, 255, 0.06)' 
                            : index % 2 === 1 
                              ? 'rgba(255, 255, 255, 0.005)' 
                              : 'transparent',
                          transition: 'background 0.2s',
                          borderLeft: isSelf ? '4px solid var(--powder-blue)' : 'none'
                        }}
                      >
                        {/* Rank */}
                        <td style={{ padding: '16px 24px', fontWeight: 800 }}>
                          <span style={{ 
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 26, height: 26, borderRadius: '50%',
                            background: rank === 1 ? 'var(--yellow-glow)' : rank === 2 ? 'var(--powder-blue-glow)' : rank === 3 ? 'var(--pale-orange-glow)' : 'transparent',
                            color: rank === 1 ? 'var(--yellow)' : rank === 2 ? 'var(--powder-blue)' : rank === 3 ? 'var(--pale-orange)' : 'var(--text-secondary)',
                            fontWeight: rank <= 3 ? 900 : 700,
                            border: rank <= 3 ? '1px solid' : 'none'
                          }}>
                            {rank}
                          </span>
                        </td>

                        {/* Name/Email */}
                        <td style={{ padding: '16px 24px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: isSelf ? 'var(--powder-blue)' : '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
                              {row.fullName}
                              {isSelf && <span style={{ fontSize: 10, background: 'var(--powder-blue-glow)', padding: '2px 6px', borderRadius: 8 }}>You</span>}
                              {row.isPermanentEmployee && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(46, 204, 113, 0.12)', padding: '2px 6px', borderRadius: 8 }}>
                                  <BadgeCheck size={11} color="#2ecc71" />
                                  <span style={{ fontSize: 9, fontWeight: 800, color: '#2ecc71' }}>FTE</span>
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {row.registrationNumber || row.email}
                            </span>
                          </div>
                        </td>

                        {/* Batch Name (Global Only) */}
                        {activeTab === 'global' && (
                          <td style={{ padding: '16px 24px', fontSize: 13, color: 'var(--text-secondary)' }}>
                            {row.batchName}
                          </td>
                        )}

                        {/* Option A Score */}
                        <td style={{ padding: '16px 24px', fontWeight: 800, textAlign: 'center', color: rank === 1 ? 'var(--yellow)' : 'var(--text-primary)' }}>
                          {formatScore(row.overallScore)}
                        </td>

                        {/* BNB Points */}
                        <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                          <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--yellow)' }}>
                            {row.bytesTotal || 0}
                            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 1 }}>B</span>
                            <span style={{ margin: '0 4px', color: 'var(--text-muted)' }}>·</span>
                            {row.bitsAccumulated || 0}
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginLeft: 1 }}>b</span>
                          </span>
                        </td>

                        {/* Assessment Average */}
                        <td style={{ padding: '16px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          {formatScore(row.assessmentScore)}
                        </td>

                        {/* Attendance */}
                        <td style={{ padding: '16px 24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          {formatAttendance(row.attendancePercentage)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalRecords > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', padding: '16px 24px' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Showing {Math.min((currentPage - 1) * 10 + 1, totalRecords)} to {Math.min(currentPage * 10, totalRecords)} of {totalRecords} records
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button 
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    className="btn-secondary"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 8,
                      fontSize: 13, fontWeight: 600,
                      cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1
                    }}
                  >
                    Prev
                  </button>
                  <button 
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    className="btn-secondary"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 8,
                      fontSize: 13, fontWeight: 600,
                      cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.5 : 1
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
