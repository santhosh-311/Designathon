import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Search, User, Edit3, Calendar, BookOpen, Sliders, AlertCircle, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { useBatches, Batch } from '@/context/BatchContext';
import { useNotifications } from '@/context/NotificationContext';
import MorphLoader from '@/components/MorphLoader';
import toast from 'react-hot-toast';
import api from '@/services/api';
import CustomDatePicker from '@/components/CustomDatePicker';

interface EditBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  batch: Batch | null;
}

export interface TopicInput {
  name: string;
  subtopics: string[];
}

interface Trainer {
  id: string;
  fullName: string;
  email: string;
}

export default function EditBatchModal({ isOpen, onClose, batch }: EditBatchModalProps) {
  const { updateBatch } = useBatches();
  const { addNotification } = useNotifications();
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const [batchName, setBatchName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sizeLimit, setSizeLimit] = useState<number | ''>('');
  const [minBatchSizeLimit, setMinBatchSizeLimit] = useState(30);
  const [topics, setTopics] = useState<TopicInput[]>([{ name: '', subtopics: [''] }]);
  const [currentTopicPage, setCurrentTopicPage] = useState(0);
  
  // Trainer search & select states
  const [availableTrainers, setAvailableTrainers] = useState<Trainer[]>([]);
  const [selectedTrainer, setSelectedTrainer] = useState<Trainer | null>(null);
  const [trainerSearch, setTrainerSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  const handleAIGenerateCurriculum = async () => {
    if (!batchName.trim()) {
      toast.error('Please enter a Batch Title first!');
      return;
    }
    try {
      setAiGenerating(true);
      const topicsCount = Number(localStorage.getItem('mep-ai-topics-count')) || 5;
      const subtopicsCount = Number(localStorage.getItem('mep-ai-subtopics-count')) || 6;
      
      const response = await api.post('/batch/generate-curriculum', {
        batchName: batchName,
        topicsCount,
        subtopicsCount
      });
      
      if (response.data && Array.isArray(response.data.curriculum)) {
        const mappedTopics = response.data.curriculum.map((item: any) => ({
          name: item.topic,
          subtopics: Array.isArray(item.subtopics) ? item.subtopics : ['']
        }));
        
        setTopics(mappedTopics);
        setCurrentTopicPage(0);
        toast.success('AI curriculum generated successfully!');
      } else {
        toast.error('Failed to parse AI curriculum. Please try again.');
      }
    } catch (error: any) {
      console.error('Failed to generate curriculum:', error);
      const errMsg = error.response?.data?.detail || 'Curriculum generation failed. Please try again.';
      toast.error(errMsg);
    } finally {
      setAiGenerating(false);
    }
  };

  // Fetch trainers from backend & populate data on open
  useEffect(() => {
    if (isOpen && batch) {
      // Set simple fields
      setBatchName(batch.batchName);
      setStartDate(batch.startDate);
      setEndDate(batch.endDate);
      setSizeLimit(batch.sizeLimit === null ? '' : batch.sizeLimit);
      setCurrentTopicPage(0);
      
      // Parse serialized topics back into name & subtopics
      if (batch.topics && batch.topics.length > 0) {
        const parsed = batch.topics.map(topicStr => {
          const colonIndex = topicStr.indexOf(':');
          if (colonIndex !== -1) {
            const name = topicStr.substring(0, colonIndex).trim();
            const subtopicsStr = topicStr.substring(colonIndex + 1).trim();
            const subtopics = subtopicsStr.split(',').map(s => s.trim()).filter(s => s !== '');
            return { name, subtopics: subtopics.length > 0 ? subtopics : [''] };
          }
          return { name: topicStr.trim(), subtopics: [''] };
        });
        setTopics(parsed);
      } else {
        setTopics([{ name: '', subtopics: [''] }]);
      }
      
      // Load min size limit
      api.get('/batch/min-size-limit')
        .then(response => {
          if (response.data && typeof response.data.minBatchSizeLimit === 'number') {
            setMinBatchSizeLimit(response.data.minBatchSizeLimit);
          }
        })
        .catch(err => {
          console.warn('Failed to load min size limit:', err);
        });
    }
  }, [isOpen, batch]);

  // Load trainers when modal opens or dates change
  useEffect(() => {
    if (isOpen && batch) {
      const params: any = { limit: 100 };
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      params.exclude_batch_id = batch._id;

      api.get('/users/trainers', { params })
        .then(response => {
          if (response.data && response.data.data) {
            const trainersList = response.data.data.map((t: any) => ({
              id: t.id,
              fullName: t.fullName,
              email: t.email
            }));
            setAvailableTrainers(trainersList);
            
            // Try to pre-select current trainer
            if (batch.trainer) {
              const currentTrainer = trainersList.find((t: Trainer) => t.fullName === batch.trainer);
              if (currentTrainer) {
                setSelectedTrainer(currentTrainer);
              } else {
                setSelectedTrainer({
                  id: 'existing',
                  fullName: batch.trainer,
                  email: ''
                });
              }
            } else {
              setSelectedTrainer(null);
            }
          }
        })
        .catch(err => {
          console.warn('Failed to load trainers:', err);
          setAvailableTrainers([]);
        });
    }
  }, [isOpen, batch, startDate, endDate]);

  // Click outside listener for dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen || !batch) return null;

  const handleAddTopic = () => {
    setTopics([...topics, { name: '', subtopics: [''] }]);
    setCurrentTopicPage(topics.length);
  };

  const handleTopicNameChange = (index: number, value: string) => {
    const newTopics = [...topics];
    newTopics[index].name = value;
    setTopics(newTopics);
  };

  const handleRemoveTopic = (index: number) => {
    const newTopics = topics.filter((_, i) => i !== index);
    if (newTopics.length === 0) {
      setTopics([{ name: '', subtopics: [''] }]);
      setCurrentTopicPage(0);
    } else {
      setTopics(newTopics);
      setCurrentTopicPage(prev => Math.max(0, Math.min(newTopics.length - 1, prev)));
    }
  };

  const handleAddSubtopic = (topicIndex: number) => {
    const newTopics = [...topics];
    newTopics[topicIndex].subtopics.push('');
    setTopics(newTopics);
  };

  const handleSubtopicChange = (topicIndex: number, subtopicIndex: number, value: string) => {
    const newTopics = [...topics];
    newTopics[topicIndex].subtopics[subtopicIndex] = value;
    setTopics(newTopics);
  };

  const handleRemoveSubtopic = (topicIndex: number, subtopicIndex: number) => {
    const newTopics = [...topics];
    newTopics[topicIndex].subtopics = newTopics[topicIndex].subtopics.filter((_, i) => i !== subtopicIndex);
    if (newTopics[topicIndex].subtopics.length === 0) {
      newTopics[topicIndex].subtopics.push('');
    }
    setTopics(newTopics);
  };

  const handleSelectTrainer = (trainer: Trainer) => {
    setSelectedTrainer(trainer);
    setTrainerSearch('');
    setShowDropdown(false);
  };

  const handleRemoveTrainer = () => {
    setSelectedTrainer(null);
  };

  const filteredTrainers = availableTrainers.filter(t => 
    t.fullName.toLowerCase().includes(trainerSearch.toLowerCase())
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!batchName || !startDate || !endDate) {
      toast.error('Please fill in all required fields.');
      return;
    }

    if (sizeLimit !== '' && Number(sizeLimit) < minBatchSizeLimit) {
      toast.error(`Batch size limit must be at least ${minBatchSizeLimit} trainees.`);
      return;
    }

    const serializedTopics = topics
      .filter(t => t.name.trim() !== '')
      .map(t => {
        const subs = t.subtopics.filter(s => s.trim() !== '');
        return subs.length > 0 ? `${t.name.trim()}: ${subs.join(', ')}` : t.name.trim();
      });

    if (serializedTopics.length === 0) {
      toast.error('Please add at least one topic.');
      return;
    }

    updateBatch(batch._id, {
      batchName,
      topics: serializedTopics,
      startDate,
      endDate,
      sizeLimit: sizeLimit === '' ? null : Number(sizeLimit),
      trainer: selectedTrainer ? selectedTrainer.fullName : undefined,
    });

    addNotification('BATCH_UPDATE', `Batch "${batchName}" details have been updated.`);
    onClose();
  };

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.6)', zIndex: 1000,
      backdropFilter: 'blur(10px)', overflowY: 'auto', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '40px 24px'
    }}>
      <div style={{
        background: 'var(--bg-dropdown)', borderRadius: 24, width: '100%', maxWidth: 1100,
        display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-card)', border: '1px solid var(--border-color)',
        position: 'relative', overflow: 'hidden', fontFamily: 'Plus Jakarta Sans, sans-serif'
      }}>
        
        {/* Modal Header */}
        <div style={{ 
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
          padding: '24px 32px', borderBottom: '1px solid var(--border-color)', background: 'linear-gradient(to right, var(--bg-dropdown), var(--bg-card))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'var(--powder-blue)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px var(--powder-blue-glow)'
            }}>
              <Edit3 size={18} color="#ffffff" strokeWidth={2.5} />
            </div>
            <div>
              <h2 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Configure Cohort</h2>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0 0', fontWeight: 500 }}>Update batch details, curriculum mapping, and trainer assignment</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            style={{ 
              background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)',
              width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center',
              justifyContent: 'center', transition: 'all 0.2s', border: '1px solid var(--border-color)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-card)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Form body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1.1fr 1.9fr', 
            gap: 40, 
            padding: '32px',
            maxHeight: 'calc(80vh - 180px)',
            overflowY: 'auto',
            background: 'var(--bg-dropdown)'
          }}>
            
            {/* Left Column: General Configuration */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, borderRight: '1px solid var(--border-color)', paddingRight: 32 }}>
              
              <div style={{
                fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', display: 'flex',
                alignItems: 'center', gap: 8, letterSpacing: '0.05em', borderBottom: '1px solid var(--border-color)', paddingBottom: 10
              }}>
                <Sliders size={16} color="var(--powder-blue)" strokeWidth={2.5} />
                <span>GENERAL SETTINGS</span>
              </div>

              {/* Batch Title */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Batch Title *</label>
                <input 
                  type="text" value={batchName} onChange={(e) => setBatchName(e.target.value)}
                  placeholder="e.g. React Native Mobile Cohort"
                  required
                  style={{ 
                    width: '100%', padding: '12px 16px', borderRadius: 12, 
                    border: '1px solid var(--border-color)', outline: 'none', fontSize: 13.5,
                    background: 'var(--bg-card)', color: 'var(--text-primary)', fontWeight: 500,
                    transition: 'all 0.15s ease-in-out'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'var(--powder-blue)';
                    e.target.style.boxShadow = '0 0 0 3px var(--powder-blue-glow)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'var(--border-color)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Start Date */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={13} color="var(--text-secondary)" /> Start Date *
                  </span>
                </label>
                <CustomDatePicker
                  value={startDate}
                  onChange={setStartDate}
                />
              </div>

              {/* End Date */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={13} color="var(--text-secondary)" /> End Date *
                  </span>
                </label>
                <CustomDatePicker
                  value={endDate}
                  onChange={setEndDate}
                />
              </div>

              {/* Batch Size Limit */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  Batch Size Limit <span style={{ color: 'var(--text-muted)', fontWeight: 500, textTransform: 'none' }}>(optional)</span>
                </label>
                <input 
                  type="number" value={sizeLimit} onChange={(e) => setSizeLimit(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={`e.g. 40 (minimum ${minBatchSizeLimit})`} min={minBatchSizeLimit}
                  style={{ 
                    width: '100%', padding: '12px 16px', borderRadius: 12, 
                    border: '1px solid var(--border-color)', outline: 'none', fontSize: 13.5,
                    background: 'var(--bg-card)', color: 'var(--text-primary)', fontWeight: 500,
                    transition: 'all 0.15s ease-in-out'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'var(--powder-blue)';
                    e.target.style.boxShadow = '0 0 0 3px var(--powder-blue-glow)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'var(--border-color)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Search-and-Select Trainer */}
              <div ref={dropdownRef} style={{ position: 'relative', paddingBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Assign Trainer</label>
                
                {selectedTrainer ? (
                  /* Selected Trainer Card */
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 16px', borderRadius: 16, border: '1px solid var(--powder-blue)',
                    background: 'var(--powder-blue-glow)',
                    boxShadow: 'none'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%', 
                        background: 'var(--powder-blue)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 8px var(--powder-blue-glow)'
                      }}>
                        <User size={16} color="#ffffff" strokeWidth={2.5} />
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedTrainer.fullName}</div>
                        {selectedTrainer.email && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 500 }}>{selectedTrainer.email}</div>}
                      </div>
                    </div>
                    <button 
                      type="button" 
                      onClick={handleRemoveTrainer}
                      style={{ 
                        border: 'none', background: 'transparent', color: '#ef4444', 
                        cursor: 'pointer', display: 'inline-flex', padding: 8,
                        borderRadius: 10, transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  /* Search Input */
                  <div style={{ position: 'relative' }}>
                    <Search size={16} color="var(--text-secondary)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
                    <input 
                      type="text" 
                      value={trainerSearch} 
                      onChange={(e) => {
                        setTrainerSearch(e.target.value);
                        setShowDropdown(true);
                      }}
                      onFocus={(e) => {
                        setShowDropdown(true);
                        e.target.style.borderColor = 'var(--powder-blue)';
                        e.target.style.boxShadow = '0 0 0 3px var(--powder-blue-glow)';
                      }}
                      placeholder="Search and select trainer..."
                      style={{ 
                        width: '100%', padding: '12px 16px 12px 38px', borderRadius: 12, 
                        border: '1px solid var(--border-color)', outline: 'none', fontSize: 13.5,
                        background: 'var(--bg-card)', color: 'var(--text-primary)', fontWeight: 500,
                        transition: 'all 0.15s ease-in-out'
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = 'var(--border-color)';
                        e.target.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                )}

                {/* Dropdown Options Popup */}
                {!selectedTrainer && showDropdown && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1100,
                    background: 'var(--bg-dropdown)', border: '1px solid var(--border-color)', borderRadius: 14,
                    boxShadow: 'var(--shadow-card)', 
                    marginTop: 6, maxHeight: 180, overflowY: 'auto', padding: 6
                  }}>
                    {filteredTrainers.length === 0 ? (
                      <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500 }}>
                        No trainers found matching "{trainerSearch}"
                      </div>
                    ) : (
                      filteredTrainers.map(t => (
                        <div 
                          key={t.id}
                          onClick={() => handleSelectTrainer(t)}
                          style={{
                            padding: '10px 14px', cursor: 'pointer', transition: 'all 0.15s',
                            display: 'flex', flexDirection: 'column', fontSize: 13,
                            borderRadius: 8,
                            color: 'var(--text-primary)'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--bg-card)';
                            e.currentTarget.style.color = 'var(--powder-blue)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--text-primary)';
                          }}
                        >
                          <span style={{ fontWeight: 700, color: 'inherit' }}>{t.fullName}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{t.email}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Curriculum Configuration */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              
              <div style={{
                fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', display: 'flex',
                alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: 10
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '0.05em' }}>
                  <BookOpen size={16} color="#f9a51b" strokeWidth={2.5} />
                  <span>CURRICULUM SCHEMA & TOPICS</span>
                </div>

                <button
                  type="button"
                  onClick={handleAIGenerateCurriculum}
                  disabled={aiGenerating}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', background: 'rgba(249, 165, 27, 0.1)',
                    color: '#f9a51b', border: '1px solid rgba(249, 165, 27, 0.3)',
                    borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    opacity: aiGenerating ? 0.7 : 1,
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => { if (!aiGenerating) { e.currentTarget.style.background = '#f9a51b'; e.currentTarget.style.color = '#131313'; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(249, 165, 27, 0.1)'; e.currentTarget.style.color = '#f9a51b'; }}
                >
                  {aiGenerating ? (
                    <>
                      <MorphLoader inline />
                      <span>Generating...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} />
                      <span>Suggest via AI</span>
                    </>
                  )}
                </button>
              </div>

              {/* Topics Container */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {topics.length > 0 && (() => {
                  const topicIdx = Math.min(currentTopicPage, topics.length - 1);
                  const topic = topics[topicIdx] || topics[0];
                  if (!topic) return null;

                  return (
                    <div 
                      key={topicIdx} 
                      style={{ 
                        border: '1px solid var(--border-color)', 
                        borderRadius: 16, 
                        padding: 20, 
                        background: 'var(--bg-dropdown)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 16,
                        boxShadow: 'var(--shadow-card)',
                        borderLeft: '4px solid var(--powder-blue)',
                        position: 'relative'
                      }}
                    >
                      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                            Topic Group {topicIdx + 1} Name
                          </label>
                          <input 
                            type="text" 
                            value={topic.name} 
                            onChange={(e) => handleTopicNameChange(topicIdx, e.target.value)}
                            placeholder="e.g. Core Fundamentals"
                            required
                            style={{ 
                              width: '100%', padding: '11px 14px', borderRadius: 10, 
                              border: '1px solid var(--border-color)', outline: 'none', fontSize: 13.5,
                              background: 'var(--bg-card)', color: 'var(--text-primary)', fontWeight: 700,
                              transition: 'all 0.15s ease-in-out'
                            }}
                            onFocus={(e) => {
                              e.target.style.borderColor = 'var(--powder-blue)';
                              e.target.style.boxShadow = '0 0 0 3px var(--powder-blue-glow)';
                            }}
                            onBlur={(e) => {
                              e.target.style.borderColor = 'var(--border-color)';
                              e.target.style.boxShadow = 'none';
                            }}
                          />
                        </div>
                        
                        {topics.length > 1 && (
                          <button 
                            type="button" 
                            onClick={() => handleRemoveTopic(topicIdx)}
                            style={{ 
                              padding: 10, background: 'rgba(239, 68, 68, 0.08)', color: '#ef4444', 
                              border: 'none', borderRadius: 10, cursor: 'pointer', transition: 'all 0.2s',
                              marginTop: 18
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                              e.currentTarget.style.transform = 'scale(1.02)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                              e.currentTarget.style.transform = 'scale(1)';
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>

                      {/* Subtopics Section */}
                      <div style={{ 
                        marginLeft: 14, 
                        borderLeft: '2px dashed var(--border-color)', 
                        paddingLeft: 20, 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: 10 
                      }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subtopics</label>
                        
                        {topic.subtopics.map((subtopic, subIdx) => (
                          <div key={subIdx} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <input 
                              type="text" 
                              value={subtopic} 
                              onChange={(e) => handleSubtopicChange(topicIdx, subIdx, e.target.value)}
                              placeholder={`Add Subtopic ${subIdx + 1}`}
                              style={{ 
                                flex: 1, padding: '8px 12px', borderRadius: 8, 
                                border: '1px solid var(--border-color)', outline: 'none', fontSize: 13,
                                background: 'var(--bg-card)', color: 'var(--text-primary)', fontWeight: 500,
                                transition: 'all 0.15s ease-in-out'
                              }}
                              onFocus={(e) => {
                                e.target.style.borderColor = 'var(--powder-blue)';
                                e.target.style.boxShadow = '0 0 0 2px var(--powder-blue-glow)';
                              }}
                              onBlur={(e) => {
                                e.target.style.borderColor = 'var(--border-color)';
                                e.target.style.boxShadow = 'none';
                              }}
                            />
                            {topic.subtopics.length > 1 && (
                              <button 
                                type="button" 
                                onClick={() => handleRemoveSubtopic(topicIdx, subIdx)}
                                style={{ 
                                  padding: 6, background: 'transparent', color: 'var(--text-secondary)', 
                                  border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s' 
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.color = '#ef4444';
                                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.color = 'var(--text-secondary)';
                                  e.currentTarget.style.background = 'transparent';
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                        
                        <button 
                          type="button" 
                          onClick={() => handleAddSubtopic(topicIdx)}
                          style={{ 
                            alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, 
                            fontSize: 12.5, color: 'var(--powder-blue)', background: 'transparent', 
                            border: 'none', cursor: 'pointer', fontWeight: 700, marginTop: 4, transition: 'all 0.2s' 
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--powder-blue)'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--powder-blue)'}
                        >
                          <Plus size={14} strokeWidth={2.5} /> Add Subtopic
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Pagination Controls */}
              {topics.length > 1 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 14,
                  padding: '10px 16px',
                  marginTop: -10
                }}>
                  <button
                    type="button"
                    disabled={currentTopicPage === 0}
                    onClick={() => setCurrentTopicPage(prev => Math.max(0, prev - 1))}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: currentTopicPage === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
                      cursor: currentTopicPage === 0 ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <ChevronLeft size={14} /> Previous
                  </button>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Topic Group {currentTopicPage + 1} of {topics.length}
                  </span>
                  <button
                    type="button"
                    disabled={currentTopicPage === topics.length - 1}
                    onClick={() => setCurrentTopicPage(prev => Math.min(topics.length - 1, prev + 1))}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: currentTopicPage === topics.length - 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
                      cursor: currentTopicPage === topics.length - 1 ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              )}
              
              <button 
                type="button" 
                onClick={handleAddTopic}
                style={{ 
                  marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, 
                  padding: '12px 20px', borderRadius: 14, border: '2px dashed var(--border-color)',
                  fontSize: 13.5, color: 'var(--text-secondary)', background: 'var(--bg-card)', 
                  cursor: 'pointer', fontWeight: 700, transition: 'all 0.2s',
                  justifyContent: 'center'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--powder-blue)';
                  e.currentTarget.style.borderColor = 'var(--powder-blue)';
                  e.currentTarget.style.background = 'var(--powder-blue-glow)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.background = 'var(--bg-card)';
                }}
              >
                <Plus size={16} strokeWidth={2.5} /> Add Another Topic Group
              </button>
            </div>

          </div>

          {/* Modal Footer Controls */}
          <div style={{ 
            display: 'flex', justifyContent: 'flex-end', gap: 14, 
            borderTop: '1px solid var(--border-color)', padding: '24px 32px', 
            background: 'var(--bg-dropdown)', borderBottomLeftRadius: 24, borderBottomRightRadius: 24
          }}>
            <button 
              type="button" 
              onClick={onClose} 
              style={{ 
                padding: '11px 24px', borderRadius: 12, background: 'transparent', 
                color: 'var(--text-secondary)', border: '1px solid var(--border-color)', fontWeight: 700, 
                fontSize: 13.5, cursor: 'pointer', transition: 'all 0.2s' 
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-card)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              style={{ 
                padding: '11px 26px', borderRadius: 12, 
                background: 'var(--powder-blue)', 
                color: '#ffffff', border: 'none', fontWeight: 700, 
                fontSize: 13.5, cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: '0 4px 12px var(--powder-blue-glow)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.02)';
                e.currentTarget.style.boxShadow = '0 6px 16px var(--powder-blue-glow)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 4px 12px var(--powder-blue-glow)';
              }}
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
