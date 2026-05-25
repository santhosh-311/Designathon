import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Users, Calendar, BookOpen, Plus, UserPlus, FileText, CheckCircle, Info, Loader2, Trash2, UserMinus, UserCheck, RotateCcw } from 'lucide-react';
import { useBatches, Batch } from '@/context/BatchContext';
import { useNotifications } from '@/context/NotificationContext';
import { useAuth } from '@/context/AuthContext';
import api from '@/services/api';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

interface BatchDetailsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  batch: Batch | null;
}

interface Candidate {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  registrationNumber: string;
  isActive?: boolean;
}

interface AttendanceSummary {
  date: string;
  presentCount: number;
  absentCount: number;
  leaveCount: number;
}

export default function BatchDetailsDrawer({ isOpen, onClose, batch }: BatchDetailsDrawerProps) {
  const { addNotification } = useNotifications();
  const { generateAssessment } = useBatches();
  const { user } = useAuth();
  const isCoordinator = user?.role === 'COORDINATOR';
  const [activeTab, setActiveTab] = useState<'trainees' | 'attendance' | 'curriculum' | 'assessment'>('trainees');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [attendance, setAttendance] = useState<AttendanceSummary[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateAssessment = async () => {
    if (!batch) return;
    try {
      setIsGenerating(true);
      await generateAssessment(batch._id);
    } catch (err) {
      // Errors are already handled inside generateAssessment toast
    } finally {
      setIsGenerating(false);
    }
  };
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  
  // Add Candidate Form
  const [showAddForm, setShowAddForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addingCandidate, setAddingCandidate] = useState(false);
  
  // Custom Confirmation Pop-up State
  const [showConfirm, setShowConfirm] = useState<{
    type: 'delete' | 'status';
    candidateId: string;
    fullName: string;
    currentActive?: boolean;
  } | null>(null);

  // Attendance Details Popup State
  const [selectedAttendanceDate, setSelectedAttendanceDate] = useState<string | null>(null);
  const [attendanceDetailsLoading, setAttendanceDetailsLoading] = useState(false);
  const [attendanceDetails, setAttendanceDetails] = useState<{
    present: Candidate[];
    absent: Candidate[];
    leave: Candidate[];
  } | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<'present' | 'absent' | 'leave'>('present');
  const [hoveredAttendanceRow, setHoveredAttendanceRow] = useState<number | null>(null);

  // Load batch candidates
  const fetchCandidates = async () => {
    if (!batch) return;
    try {
      setLoadingCandidates(true);
      const response = await api.get(`/batch/${batch._id}/candidates`);
      if (Array.isArray(response.data)) {
        setCandidates(response.data);
      }
    } catch (err) {
      console.error('Failed to load batch candidates:', err);
    } finally {
      setLoadingCandidates(false);
    }
  };

  // Load attendance summary
  const fetchAttendanceSummary = async () => {
    if (!batch) return;
    try {
      setLoadingAttendance(true);
      const response = await api.get(`/batch/${batch._id}/attendance-summary`);
      if (Array.isArray(response.data)) {
        setAttendance(response.data);
      }
    } catch (err) {
      console.error('Failed to load attendance summary:', err);
    } finally {
      setLoadingAttendance(false);
    }
  };

  useEffect(() => {
    if (isOpen && batch) {
      fetchCandidates();
      fetchAttendanceSummary();
      setShowAddForm(false);
      setFullName('');
      setEmail('');
      setPhone('');
    }
  }, [isOpen, batch]);

  if (!isOpen || !batch) return null;

  const handleAddCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !email) {
      toast.error('Name and Email are required.');
      return;
    }

    try {
      setAddingCandidate(true);
      const response = await api.post(`/batch/${batch._id}/candidates`, {
        fullName,
        email,
        phone: phone || undefined,
        batchId: batch._id
      });
      if (response.data) {
        toast.success('Candidate added to batch successfully!');
        // Update notification
        addNotification('CANDIDATE_ASSIGNMENT', `Trainee "${fullName}" has been assigned to batch "${batch.batchName}".`);
        // Refresh candidates list
        await fetchCandidates();
        // Reset form
        setFullName('');
        setEmail('');
        setPhone('');
        setShowAddForm(false);
      }
    } catch (err: any) {
      console.error('Failed to add candidate:', err);
      toast.error(err.response?.data?.detail || 'Failed to add candidate to batch.');
    } finally {
      setAddingCandidate(false);
    }
  };

  const triggerDeleteConfirm = (candidateId: string, fullName: string) => {
    setShowConfirm({
      type: 'delete',
      candidateId,
      fullName
    });
  };

  const triggerStatusConfirm = (candidateId: string, fullName: string, currentActive: boolean) => {
    setShowConfirm({
      type: 'status',
      candidateId,
      fullName,
      currentActive
    });
  };

  const confirmDeleteAction = async () => {
    if (!batch || !showConfirm) return;
    const { candidateId, fullName } = showConfirm;
    setShowConfirm(null);

    try {
      toast.loading('Deleting candidate...', { id: 'delete-candidate' });
      await api.delete(`/batch/${batch._id}/candidates/${candidateId}`);
      toast.success('Candidate deleted successfully!', { id: 'delete-candidate' });
      addNotification('SYSTEM', `Trainee "${fullName}" has been removed from batch "${batch.batchName}".`);
      await fetchCandidates();
    } catch (err: any) {
      console.error('Failed to delete candidate:', err);
      toast.error(err.response?.data?.detail || 'Failed to delete candidate.', { id: 'delete-candidate' });
    }
  };

  const confirmStatusAction = async () => {
    if (!batch || !showConfirm) return;
    const { candidateId, fullName, currentActive } = showConfirm;
    setShowConfirm(null);
    const nextActive = !currentActive;

    try {
      toast.loading(`Updating candidate status...`, { id: 'status-candidate' });
      await api.put(`/batch/${batch._id}/candidates/${candidateId}/status`, {
        isActive: nextActive
      });
      toast.success(`Candidate ${nextActive ? 'activated' : 'deactivated'} successfully!`, { id: 'status-candidate' });
      addNotification('SYSTEM', `Trainee "${fullName}" status set to ${nextActive ? 'Active' : 'Inactive'}.`);
      await fetchCandidates();
    } catch (err: any) {
      console.error('Failed to update candidate status:', err);
      toast.error(err.response?.data?.detail || 'Failed to update status.', { id: 'status-candidate' });
    }
  };

  const handleAttendanceDateClick = async (dateStr: string) => {
    if (!batch) return;
    
    const clickedDateKey = dateStr.substring(0, 10);
    setSelectedAttendanceDate(dateStr);
    setAttendanceDetailsLoading(true);
    setActiveDetailTab('present');
    
    try {
      const response = await api.get(`/attendance/batch/${batch._id}`);
      const allRecords = response.data;
      
      const presentees: Candidate[] = [];
      const absentees: Candidate[] = [];
      const leavees: Candidate[] = [];
      
      candidates.forEach(cand => {
        const record = allRecords.find((r: any) => r.candidateId === cand.id && r.date.substring(0, 10) === clickedDateKey);
        if (record) {
          if (record.status === 'PRESENT') {
            presentees.push(cand);
          } else if (record.status === 'LEAVE') {
            leavees.push(cand);
          } else {
            absentees.push(cand);
          }
        } else {
          absentees.push(cand);
        }
      });
      
      setAttendanceDetails({
        present: presentees,
        absent: absentees,
        leave: leavees
      });
    } catch (err) {
      console.error('Failed to load attendance details:', err);
      toast.error('Failed to load attendance details list.');
      setSelectedAttendanceDate(null);
    } finally {
      setAttendanceDetailsLoading(false);
    }
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', justifyContent: 'flex-end',
      background: 'rgba(10, 15, 30, 0.5)',
      backdropFilter: 'blur(8px)',
      animation: 'fadeIn 0.2s ease-out'
    }}>,
      {/* Click outside to close backdrop area */}
      <div 
        onClick={onClose} 
        style={{ flex: 1, height: '100%' }} 
      />

      {/* Slide-over Drawer Panel */}
      <div style={{
        width: '100%', maxWidth: 520, height: '100%',
        background: '#121824', borderLeft: '1px solid var(--border-color)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.4)',
        animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        color: '#f8fafc'
      }}>
        {/* Drawer Header */}
        <div style={{
          padding: '24px 28px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
        }}>
          <div>
            <span style={{ 
              fontSize: 10, fontWeight: 700, color: 'var(--powder-blue)', 
              textTransform: 'uppercase', letterSpacing: 1.5, display: 'block', marginBottom: 4
            }}>
              Batch Details
            </span>
            <h2 style={{ fontSize: 20, fontWeight: 800, fontFamily: 'Outfit, sans-serif', color: '#ffffff' }}>
              {batch.batchName}
            </h2>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', display: 'block', marginTop: 4 }}>
              {batch.batchId}
            </span>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.05)', border: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)', width: 36, height: 36, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; e.currentTarget.style.color = '#ffffff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Info Grid (Quick metadata summary) */}
        <div style={{
          padding: '16px 28px', background: 'rgba(15, 23, 42, 0.4)',
          borderBottom: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#94a3b8' }}>
            <Calendar size={14} color="var(--powder-blue)" />
            <span>
              <strong>Schedule:</strong> {new Date(batch.startDate).toLocaleDateString()} - {new Date(batch.endDate).toLocaleDateString()}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#94a3b8' }}>
            <Users size={14} color="var(--pale-orange)" />
            <span>
              <strong>Limit:</strong> {batch.sizeLimit ? `${candidates.length} / ${batch.sizeLimit} max` : `${candidates.length} candidates`}
            </span>
          </div>
          {batch.trainer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#94a3b8', gridColumn: 'span 2' }}>
              <BookOpen size={14} color="var(--yellow)" />
              <span>
                <strong>Assigned Trainer:</strong> {batch.trainer}
              </span>
            </div>
          )}
        </div>

        {/* Tab Selection */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--border-color)',
          padding: '0 28px', background: '#121824'
        }}>
          {(['trainees', 'attendance', 'curriculum', 'assessment'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '14px 16px', background: 'transparent', border: 'none',
                color: activeTab === tab ? 'var(--powder-blue)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer', position: 'relative',
                transition: 'color 0.2s'
              }}
            >
              {tab === 'trainees' 
                ? 'Trainees List' 
                : tab === 'attendance' 
                  ? 'Attendance Logs' 
                  : tab === 'curriculum' 
                    ? 'Curriculum' 
                    : 'AI Assessment'}
              {activeTab === tab && (
                <div style={{
                  position: 'absolute', bottom: -1, left: 16, right: 16, height: 2,
                  background: 'var(--powder-blue)', boxShadow: '0 0 6px var(--powder-blue)'
                }} />
              )}
            </button>
          ))}
        </div>

        {/* Tab Contents */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {activeTab === 'trainees' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Add Candidate Trigger */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Total Enrolled: {candidates.length}
                </span>
                
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  style={{
                    padding: '6px 12px', background: showAddForm ? 'rgba(255, 107, 107, 0.15)' : 'var(--powder-blue-glow)',
                    color: showAddForm ? '#ff6b6b' : 'var(--powder-blue)', border: showAddForm ? '1px solid #ff6b6b' : '1px solid var(--powder-blue)',
                    borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 4
                  }}
                >
                  {showAddForm ? 'Cancel' : <><Plus size={14} /> Add Trainee</>}
                </button>
              </div>

              {/* Add Candidate Form Dropdown */}
              {showAddForm && (
                <form 
                  onSubmit={handleAddCandidate}
                  style={{
                    padding: 16, border: '1px solid var(--border-color)', borderRadius: 12,
                    background: 'rgba(15, 23, 42, 0.5)', display: 'flex', flexDirection: 'column', gap: 12
                  }}
                >
                  <h4 style={{ fontSize: 13, fontWeight: 700, color: '#ffffff' }}>Add New Trainee</h4>
                  
                  <div>
                    <input 
                      type="text" placeholder="Full Name *" value={fullName} onChange={(e) => setFullName(e.target.value)}
                      required
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, background: '#1e293b',
                        border: '1px solid var(--border-color)', outline: 'none', color: '#ffffff', fontSize: 13
                      }}
                    />
                  </div>

                  <div>
                    <input 
                      type="email" placeholder="Email Address *" value={email} onChange={(e) => setEmail(e.target.value)}
                      required
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, background: '#1e293b',
                        border: '1px solid var(--border-color)', outline: 'none', color: '#ffffff', fontSize: 13
                      }}
                    />
                  </div>

                  <div>
                    <input 
                      type="text" placeholder="Phone Number (Optional)" value={phone} onChange={(e) => setPhone(e.target.value)}
                      style={{
                        width: '100%', padding: '8px 12px', borderRadius: 8, background: '#1e293b',
                        border: '1px solid var(--border-color)', outline: 'none', color: '#ffffff', fontSize: 13
                      }}
                    />
                  </div>

                  <button
                    type="submit" disabled={addingCandidate}
                    style={{
                      padding: '8px 16px', background: 'var(--powder-blue)', color: '#0f172a',
                      border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      marginTop: 4
                    }}
                  >
                    {addingCandidate ? 'Adding...' : 'Add Trainee to Batch'}
                  </button>
                </form>
              )}

              {/* Trainee list */}
              {loadingCandidates ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                  Loading candidates...
                </div>
              ) : candidates.length === 0 ? (
                <div style={{
                  padding: '32px 16px', textAlign: 'center', background: 'rgba(255,255,255,0.02)',
                  borderRadius: 12, border: '1px dashed var(--border-color)'
                }}>
                  <UserPlus size={36} color="var(--text-secondary)" style={{ margin: '0 auto 12px' }} />
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No candidates enrolled in this batch yet.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Coordinator Swipe Instruction */}
                  {isCoordinator && (
                    <div style={{ 
                      display: 'flex', alignItems: 'center', gap: 6, 
                      background: 'rgba(112, 214, 255, 0.04)', 
                      border: '1px solid rgba(112, 214, 255, 0.1)',
                      padding: '8px 12px', borderRadius: 8, fontSize: 11.5, color: 'var(--powder-blue)'
                    }}>
                      <Info size={14} />
                      <span><strong>Coordinator Action:</strong> Swipe a trainee card left to disable or delete.</span>
                    </div>
                  )}

                  <AnimatePresence>
                    {candidates.map((candidate) => (
                      <div 
                        key={candidate.id}
                        style={{
                          position: 'relative',
                          width: '100%',
                          height: 80, // Fixed height for absolute background alignment
                          background: '#0f172a', // Solid base background under swiped card
                          borderRadius: 12,
                          overflow: 'hidden'
                        }}
                      >
                        {/* Hidden action buttons (revealed on drag left) */}
                        {isCoordinator && (
                          <div style={{
                            position: 'absolute', right: 0, top: 0, bottom: 0, width: 140,
                            display: 'flex', zIndex: 1, height: '100%'
                          }}>
                            {/* Deactivate/Activate Status Button */}
                            <button
                              onClick={() => triggerStatusConfirm(candidate.id, candidate.fullName, candidate.isActive !== false)}
                              style={{
                                width: 70, height: '100%', border: 'none', cursor: 'pointer',
                                background: candidate.isActive !== false ? 'var(--pale-orange)' : 'var(--powder-blue)',
                                color: '#0f172a', display: 'flex', flexDirection: 'column', 
                                alignItems: 'center', justifyContent: 'center', gap: 4, transition: 'opacity 0.2s'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                            >
                              {candidate.isActive !== false ? <UserMinus size={16} /> : <UserCheck size={16} />}
                              <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                {candidate.isActive !== false ? 'Disable' : 'Enable'}
                              </span>
                            </button>
                            
                            {/* Delete Candidate Button */}
                            <button
                              onClick={() => triggerDeleteConfirm(candidate.id, candidate.fullName)}
                              style={{
                                width: 70, height: '100%', border: 'none', cursor: 'pointer',
                                background: '#ef4444', color: '#ffffff', display: 'flex', 
                                flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                                transition: 'opacity 0.2s'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                            >
                              <Trash2 size={16} />
                              <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                Delete
                              </span>
                            </button>
                          </div>
                        )}

                        {/* Drag Card layer (solid background to prevent action button leaks) */}
                        <motion.div
                          drag={isCoordinator ? "x" : false}
                          dragDirectionLock
                          dragConstraints={{ left: -140, right: 0 }}
                          dragElastic={{ left: 0.1, right: 0.02 }}
                          whileDrag={{ scale: 1.005, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
                          style={{
                            position: 'relative',
                            zIndex: 2,
                            width: '100%',
                            height: '100%',
                            padding: '14px 16px',
                            borderRadius: 12,
                            background: '#1e293b', // Always completely solid slate background
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            cursor: isCoordinator ? 'grab' : 'default',
                            boxSizing: 'border-box'
                          }}
                        >
                          {/* Inner content container (dims dynamically without leaking background options) */}
                          <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            width: '100%',
                            opacity: candidate.isActive !== false ? 1 : 0.6,
                            transition: 'opacity 0.2s'
                          }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ 
                                  fontSize: 13.5, 
                                  fontWeight: 700, 
                                  color: candidate.isActive !== false ? '#ffffff' : 'var(--text-secondary)',
                                  textDecoration: candidate.isActive !== false ? 'none' : 'line-through'
                                }}>
                                  {candidate.fullName}
                                </span>
                                {candidate.isActive === false && (
                                  <span style={{
                                    fontSize: 8.5, fontWeight: 800, background: 'rgba(255, 160, 89, 0.15)',
                                    color: 'var(--pale-orange)', padding: '2px 6px', borderRadius: 4,
                                    border: '1px solid rgba(255, 160, 89, 0.3)'
                                  }}>
                                    INACTIVE
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{candidate.email}</div>
                              {candidate.phone && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{candidate.phone}</div>}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ 
                                fontSize: 10.5, fontFamily: 'monospace', background: 'rgba(255,255,255,0.05)',
                                padding: '4px 8px', borderRadius: 6, color: 'var(--powder-blue)', fontWeight: 600
                              }}>
                                {candidate.registrationNumber}
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      </div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}

          {activeTab === 'attendance' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                Attendance Summary by Date
              </span>

              {loadingAttendance ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                  Loading logs...
                </div>
              ) : attendance.length === 0 ? (
                <div style={{
                  padding: '32px 16px', textAlign: 'center', background: 'rgba(255,255,255,0.02)',
                  borderRadius: 12, border: '1px dashed var(--border-color)'
                }}>
                  <Info size={36} color="var(--text-secondary)" style={{ margin: '0 auto 12px' }} />
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No attendance sessions logged for this batch.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {attendance.map((day, i) => (
                    <div 
                      key={i}
                      onClick={() => handleAttendanceDateClick(day.date)}
                      onMouseEnter={() => setHoveredAttendanceRow(i)}
                      onMouseLeave={() => setHoveredAttendanceRow(null)}
                      style={{
                        padding: 14, borderRadius: 12, 
                        background: hoveredAttendanceRow === i ? 'rgba(112, 214, 255, 0.04)' : 'rgba(255,255,255,0.02)',
                        border: hoveredAttendanceRow === i ? '1px solid rgba(112, 214, 255, 0.35)' : '1px solid var(--border-color)', 
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', cursor: 'pointer',
                        transform: hoveredAttendanceRow === i ? 'translateY(-1px)' : 'translateY(0)',
                        boxShadow: hoveredAttendanceRow === i ? '0 4px 12px rgba(112, 214, 255, 0.05)' : 'none',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Calendar size={16} color="var(--powder-blue)" />
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: hoveredAttendanceRow === i ? 'var(--powder-blue)' : '#ffffff', transition: 'color 0.2s' }}>
                          {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ fontSize: 11, background: 'rgba(112, 214, 255, 0.1)', color: 'var(--powder-blue)', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>
                          {day.presentCount} Present
                        </span>
                        <span style={{ fontSize: 11, background: 'rgba(255, 107, 107, 0.1)', color: '#ff6b6b', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>
                          {day.absentCount} Absent
                        </span>
                        {day.leaveCount > 0 && (
                          <span style={{ fontSize: 11, background: 'rgba(25fac9, 201, 90, 0.1)', color: 'var(--yellow)', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>
                            {day.leaveCount} Leave
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'curriculum' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                Target Curriculum Topics & Subtopics
              </span>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {batch.topics.map((topicStr, i) => {
                  const colonIndex = topicStr.indexOf(':');
                  let name = topicStr;
                  let subtopics: string[] = [];
                  if (colonIndex !== -1) {
                    name = topicStr.substring(0, colonIndex).trim();
                    const subtopicsStr = topicStr.substring(colonIndex + 1).trim();
                    subtopics = subtopicsStr.split(',').map(s => s.trim()).filter(s => s !== '');
                  }
                  return (
                    <div 
                      key={i}
                      style={{
                        padding: '14px 18px', borderRadius: 14, background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 10
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <CheckCircle size={16} color="var(--powder-blue)" />
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{name}</span>
                      </div>
                      {subtopics.length > 0 && (
                        <div style={{ 
                          marginLeft: 26, 
                          borderLeft: '1px solid rgba(255, 255, 255, 0.1)', 
                          paddingLeft: 14,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6
                        }}>
                          {subtopics.map((sub, subIdx) => (
                            <div key={subIdx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--powder-blue)', opacity: 0.6 }} />
                              <span>{sub}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'assessment' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  AI-Generated Multiple-Choice Questions
                </span>
                {batch.questions && batch.questions.length > 0 && (user?.role === 'ADMIN' || user?.role === 'COORDINATOR') && (
                  <button
                    disabled={isGenerating}
                    onClick={handleGenerateAssessment}
                    style={{
                      background: 'var(--powder-blue-glow)', border: '1px solid var(--powder-blue)',
                      color: 'var(--powder-blue)', padding: '6px 12px', borderRadius: 10,
                      fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex',
                      alignItems: 'center', gap: 6, opacity: isGenerating ? 0.7 : 1
                    }}
                  >
                    {isGenerating ? (
                      <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <Plus size={13} strokeWidth={2.5} />
                    )}
                    <span>Regenerate</span>
                  </button>
                )}
              </div>

              {!batch.questions || batch.questions.length === 0 ? (
                /* Empty State */
                <div style={{
                  padding: '40px 24px', textAlign: 'center', background: 'rgba(255,255,255,0.01)',
                  border: '1px dashed var(--border-color)', borderRadius: 16, display: 'flex',
                  flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16
                }}>
                  <Info size={36} color="var(--text-muted)" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>No Assessment Questions Ready</p>
                    <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', maxWidth: 300, margin: '0 auto', lineHeight: 1.4 }}>
                      {user?.role === 'ADMIN' || user?.role === 'COORDINATOR'
                        ? "Generate curriculum assessment MCQs based on course topics and subtopics using Gemini."
                        : "MCQs will be generated by the course Admin or Coordinator."}
                    </p>
                  </div>
                  {(user?.role === 'ADMIN' || user?.role === 'COORDINATOR') && (
                    <button
                      disabled={isGenerating}
                      onClick={handleGenerateAssessment}
                      style={{
                        background: 'linear-gradient(135deg, #0ea5e9, #2563eb)', border: 'none',
                        color: '#ffffff', padding: '10px 20px', borderRadius: 12,
                        fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex',
                        alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(14, 165, 233, 0.2)',
                        transition: 'transform 0.15s',
                        opacity: isGenerating ? 0.7 : 1
                      }}
                      onMouseEnter={(e) => { if(!isGenerating) e.currentTarget.style.transform = 'scale(1.02)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                      {isGenerating ? (
                        <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : (
                        <Plus size={15} strokeWidth={2.5} />
                      )}
                      <span>Generate AI Assessment</span>
                    </button>
                  )}
                </div>
              ) : (
                /* Questions List */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {batch.questions.map((group, groupIdx) => (
                    <div key={groupIdx} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 800, color: 'var(--powder-blue)', 
                        letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.05)',
                        paddingBottom: 6, display: 'flex', alignItems: 'center', gap: 6
                      }}>
                        <BookOpen size={13} />
                        <span>{group.topic}</span>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {group.questions.map((q, qIdx) => (
                          <div 
                            key={qIdx}
                            style={{
                              padding: 16, borderRadius: 14, background: 'rgba(255, 255, 255, 0.01)',
                              border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 12
                            }}
                          >
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                {qIdx + 1}
                              </span>
                              <span style={{ fontSize: 13.5, fontWeight: 600, color: '#f8fafc', lineHeight: 1.4 }}>
                                {q.question}
                              </span>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginLeft: 28 }}>
                              {q.options.map((opt, optIdx) => {
                                const isCorrect = opt === q.correctAnswer;
                                return (
                                  <div 
                                    key={optIdx}
                                    style={{
                                      padding: '8px 12px', borderRadius: 8,
                                      border: isCorrect ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(255,255,255,0.05)',
                                      background: isCorrect ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.02)',
                                      color: isCorrect ? 'var(--green)' : 'var(--text-secondary)',
                                      fontSize: 12.5, fontWeight: isCorrect ? 700 : 500,
                                      display: 'flex', alignItems: 'center', gap: 8
                                    }}
                                  >
                                    <span style={{ 
                                      fontSize: 10, fontWeight: 800, 
                                      background: isCorrect ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)', 
                                      color: isCorrect ? 'var(--green)' : 'var(--text-secondary)',
                                      width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' 
                                    }}>
                                      {String.fromCharCode(65 + optIdx)}
                                    </span>
                                    <span style={{ flex: 1 }}>{opt}</span>
                                    {isCorrect && (
                                      <CheckCircle size={14} color="var(--green)" />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Local keyframes for slideIn/fadeIn styles */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      {/* Custom Confirmation Dialog Overlay */}
      {showConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10, 15, 30, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: '#121824',
            border: '1px solid var(--border-color)',
            borderRadius: 16,
            padding: 24,
            width: '100%',
            maxWidth: 380,
            boxShadow: '0 24px 48px rgba(0, 0, 0, 0.6)',
            color: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            boxSizing: 'border-box'
          }}>
            {/* Header / Icon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: showConfirm.type === 'delete' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(112, 214, 255, 0.1)',
                color: showConfirm.type === 'delete' ? '#ef4444' : 'var(--powder-blue)'
              }}>
                {showConfirm.type === 'delete' ? <Trash2 size={22} /> : (showConfirm.currentActive ? <UserMinus size={22} /> : <UserCheck size={22} />)}
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, fontFamily: 'Outfit, sans-serif', color: '#ffffff', margin: 0 }}>
                  {showConfirm.type === 'delete' ? 'Delete Candidate?' : (showConfirm.currentActive ? 'Deactivate Candidate?' : 'Activate Candidate?')}
                </h3>
              </div>
            </div>

            {/* Description Text */}
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              {showConfirm.type === 'delete' ? (
                <>Are you sure you want to permanently delete <strong>{showConfirm.fullName}</strong>? This action cannot be undone and will remove them from the batch.</>
              ) : (
                showConfirm.currentActive ? (
                  <>Are you sure you want to deactivate <strong>{showConfirm.fullName}</strong>? They will be unable to log in to their account.</>
                ) : (
                  <>Are you sure you want to activate <strong>{showConfirm.fullName}</strong>? They will regain full login access to their account.</>
                )
              )}
            </p>

            {/* Buttons Layout */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              {/* Cancel Button */}
              <button
                onClick={() => setShowConfirm(null)}
                style={{
                  padding: '10px 18px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
              >
                Cancel
              </button>

              {/* Confirm Action Button */}
              <button
                onClick={showConfirm.type === 'delete' ? confirmDeleteAction : confirmStatusAction}
                style={{
                  padding: '10px 18px',
                  background: showConfirm.type === 'delete' ? '#ef4444' : (showConfirm.currentActive ? 'var(--pale-orange)' : 'var(--powder-blue)'),
                  color: showConfirm.type === 'delete' ? '#ffffff' : '#0f172a',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'opacity 0.2s'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
              >
                {showConfirm.type === 'delete' ? 'Delete' : (showConfirm.currentActive ? 'Deactivate' : 'Activate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Details Modal Overlay */}
      {selectedAttendanceDate && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10, 15, 30, 0.8)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1900,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: '#121824',
            border: '1px solid var(--border-color)',
            borderRadius: 16,
            padding: 24,
            width: '100%',
            maxWidth: 440,
            maxHeight: '85vh',
            boxShadow: '0 24px 48px rgba(0, 0, 0, 0.6)',
            color: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxSizing: 'border-box'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ 
                  fontSize: 10, fontWeight: 700, color: 'var(--powder-blue)', 
                  textTransform: 'uppercase', letterSpacing: 1.5, display: 'block', marginBottom: 4
                }}>
                  Attendance Log
                </span>
                <h3 style={{ fontSize: 16, fontWeight: 800, fontFamily: 'Outfit, sans-serif', color: '#ffffff', margin: 0 }}>
                  {new Date(selectedAttendanceDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </h3>
              </div>
              <button 
                onClick={() => { setSelectedAttendanceDate(null); setAttendanceDetails(null); }}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)', border: 'none', cursor: 'pointer',
                  color: 'var(--text-secondary)', width: 32, height: 32, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; e.currentTarget.style.color = '#ffffff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <X size={16} style={{ margin: 'auto' }} />
              </button>
            </div>

            {/* Modal Body / Loading State */}
            {attendanceDetailsLoading || !attendanceDetails ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 12 }}>
                <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--powder-blue)' }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading logs details...</span>
              </div>
            ) : (
              <>
                {/* Tab selector */}
                <div style={{
                  display: 'flex', 
                  borderBottom: '1px solid var(--border-color)',
                  background: '#121824'
                }}>
                  {(['present', 'absent', 'leave'] as const).map((tab) => {
                    const count = attendanceDetails[tab].length;
                    const isActive = activeDetailTab === tab;
                    
                    let tabColor = 'var(--powder-blue)';
                    if (tab === 'absent') tabColor = '#ff6b6b';
                    else if (tab === 'leave') tabColor = 'var(--yellow)';

                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveDetailTab(tab)}
                        style={{
                          flex: 1,
                          padding: '10px 0', background: 'transparent', border: 'none',
                          color: isActive ? tabColor : 'var(--text-secondary)',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer', position: 'relative',
                          transition: 'color 0.2s'
                        }}
                      >
                        <span style={{ textTransform: 'capitalize' }}>{tab}</span> ({count})
                        {isActive && (
                          <div style={{
                            position: 'absolute', bottom: -1, left: 10, right: 10, height: 2,
                            background: tabColor, boxShadow: `0 0 6px ${tabColor}`
                          }} />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Trainee Details scrolling list */}
                <div style={{ 
                  flex: 1, 
                  overflowY: 'auto', 
                  maxHeight: '40vh', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 10,
                  paddingRight: 4
                }}>
                  {attendanceDetails[activeDetailTab].length === 0 ? (
                    <div style={{
                      padding: '32px 16px', textAlign: 'center', background: 'rgba(255,255,255,0.01)',
                      borderRadius: 12, border: '1px dashed var(--border-color)', margin: '10px 0'
                    }}>
                      <Info size={28} color="var(--text-secondary)" style={{ margin: '0 auto 8px' }} />
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                        No candidates found in this list.
                      </p>
                    </div>
                  ) : (
                    attendanceDetails[activeDetailTab].map((cand) => (
                      <div 
                        key={cand.id}
                        style={{
                          padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)',
                          border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff' }}>{cand.fullName}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', marginTop: 2 }}>{cand.email}</div>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ 
                            fontSize: 9.5, fontFamily: 'monospace', background: 'rgba(255,255,255,0.05)',
                            padding: '3px 6px', borderRadius: 4, color: 'var(--powder-blue)', fontWeight: 600
                          }}>
                            {cand.registrationNumber}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
