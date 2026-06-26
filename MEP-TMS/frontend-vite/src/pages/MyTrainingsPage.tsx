import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Calendar, User, Clock, AlertCircle, Play, ChevronLeft, ChevronRight, X, Bot, ArrowLeft, Terminal, Award, CheckCircle, Circle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import api from '@/services/api';
import toast from 'react-hot-toast';
import MorphLoader from '@/components/MorphLoader';

export default function MyTrainingsPage() {
  const { user } = useAuth();
  const [candidate, setCandidate] = useState<any>(null);
  const [batchDetails, setBatchDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isCurriculumModalOpen, setIsCurriculumModalOpen] = useState(false);
  const [allBatchesDetails, setAllBatchesDetails] = useState<any[]>([]);
  
  // Classroom states
  const [isClassroomOpen, setIsClassroomOpen] = useState(false);
  const [isIntroduced, setIsIntroduced] = useState(false);
  const [activeTopicIdx, setActiveTopicIdx] = useState(0);
  const [activeSubtopicIdx, setActiveSubtopicIdx] = useState(0);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [completions, setCompletions] = useState<Record<string, boolean>>({});

  // Schedule and day-by-day balanced AI teaching states
  const [schedule, setSchedule] = useState<any[]>([]);
  const [activeDayNumber, setActiveDayNumber] = useState<number>(1);
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  useEffect(() => {
    const fetchTraineeBatch = async () => {
      try {
        setLoading(true);
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
          
          setCandidate(selectedCand);

          if (isAll) {
            // Fetch all batches in parallel
            const promises = candidatesList.map((c: any) => 
              c.batchId ? api.get(`/batch/${c.batchId}`).then(res => ({
                batchData: res.data,
                cand: c
              })).catch(() => null) : Promise.resolve(null)
            );
            const results = await Promise.all(promises);
            const validResults = results.filter(Boolean);
            setAllBatchesDetails(validResults);
            if (validResults.length > 0) {
              setBatchDetails(validResults[0].batchData);
            }
          } else {
            const batchId = selectedCand.batchId;
            if (batchId) {
              const batchRes = await api.get(`/batch/${batchId}`);
              if (batchRes.data) {
                setBatchDetails(batchRes.data);
                setAllBatchesDetails([{ batchData: batchRes.data, cand: selectedCand }]);
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to load trainee training batch:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchTraineeBatch();
  }, [user]);

  // Fetch schedule timeline when batchDetails changes
  useEffect(() => {
    const fetchSchedule = async () => {
      const batchId = batchDetails?.id || batchDetails?._id;
      if (!batchId) return;
      try {
        setLoadingSchedule(true);
        const res = await api.get(`/batch/${batchId}/schedule`);
        setSchedule(res.data?.targets || []);
      } catch (err) {
        console.error('Failed to fetch targets schedule:', err);
      } finally {
        setLoadingSchedule(false);
      }
    };
    fetchSchedule();
  }, [batchDetails]);

  // Helper: check if a day is AI-led
  const isDayAiLed = (dayNum: number) => {
    return !!(batchDetails?.agent?.selectedDays && batchDetails.agent.selectedDays.includes(dayNum));
  };

  const handleOpenCurriculum = (item: any) => {
    setCandidate(item.cand);
    setBatchDetails(item.batchData);
    setIsCurriculumModalOpen(true);
  };

  const handleOpenClassroom = (item: any) => {
    setCandidate(item.cand);
    setBatchDetails(item.batchData);
    
    const hasAgent = item.batchData?.agent && item.batchData.agent.status === 'ready';
    const topics = item.batchData?.agent?.content || [];
    
    if (hasAgent && topics.length > 0) {
      setIsIntroduced(false);
    }
    setIsClassroomOpen(true);
  };

  const start = batchDetails?.startDate ? new Date(batchDetails.startDate) : null;
  const end = batchDetails?.endDate ? new Date(batchDetails.endDate) : null;
  const now = new Date();

  if (start) start.setHours(0, 0, 0, 0);
  if (end) end.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  const isPlanned = !!(batchDetails && batchDetails.status === 'PLANNED' && start && now.getTime() < start.getTime());
  const isCompleted = !!(batchDetails && (batchDetails.status === 'COMPLETED' || (end && now.getTime() > end.getTime())));
  const isOngoing = !!(batchDetails && !isPlanned && !isCompleted);

  // AI Agent check
  const hasAgent = batchDetails?.agent && batchDetails.agent.status === 'ready';
  const agentName = batchDetails?.agent?.agentName || 'AI Teaching Agent';
  const topics = batchDetails?.agent?.content || [];

  const loadCompletions = () => {
    const batchId = batchDetails?.id || batchDetails?._id;
    const candidateId = candidate?.id || candidate?._id || user?.id;
    if (batchId && candidateId) {
      const newCompletions: Record<string, boolean> = {};
      const topicList = batchDetails.topics || [];
      topicList.forEach((topicName: string) => {
        const key = `completed_topic_${batchId}_${candidateId}_${topicName}`;
        newCompletions[topicName] = localStorage.getItem(key) === 'true';
      });
      const agentTopics = batchDetails.agent?.content || [];
      agentTopics.forEach((t: any) => {
        if (t && t.topic) {
          const key = `completed_topic_${batchId}_${candidateId}_${t.topic}`;
          newCompletions[t.topic] = localStorage.getItem(key) === 'true';
        }
      });
      setCompletions(newCompletions);
    }
  };

  useEffect(() => {
    loadCompletions();
  }, [batchDetails, candidate, user]);

  const toggleCompletion = (topicName: string) => {
    const batchId = batchDetails?.id || batchDetails?._id;
    const candidateId = candidate?.id || candidate?._id || user?.id;
    if (batchId && candidateId) {
      const key = `completed_topic_${batchId}_${candidateId}_${topicName}`;
      const currentlyCompleted = localStorage.getItem(key) === 'true';
      if (currentlyCompleted) {
        localStorage.removeItem(key);
        toast.success(`Marked "${topicName}" as incomplete.`);
      } else {
        localStorage.setItem(key, 'true');
        toast.success(`Marked "${topicName}" as completed!`);
      }
      loadCompletions();
    }
  };

  const handleLearnDay = (dayNum: number) => {
    if (isPlanned) return;
    setActiveDayNumber(dayNum);

    if (isDayAiLed(dayNum)) {
      const agentContent = batchDetails?.agent?.content || [];
      const tIdx = agentContent.findIndex((t: any) => t.dayNumbers && t.dayNumbers.includes(dayNum));
      if (tIdx !== -1) {
        setActiveTopicIdx(tIdx);
        setActiveSubtopicIdx(0);
        setActiveSlideIdx(0);
      }
    }
    setIsIntroduced(true);
    setIsClassroomOpen(true);
    setIsCurriculumModalOpen(false);
  };

  const handleLearnTopic = (topicName: string) => {
    if (isPlanned) return;
    
    // Try to find a matching day in the schedule for this topic
    const allDays = schedule.flatMap((w: any) => w.days || []);
    const matchingDay = allDays.find((d: any) =>
      d.topic?.toLowerCase().includes(topicName.toLowerCase()) ||
      topicName.toLowerCase().includes(d.topic?.toLowerCase())
    );
    if (matchingDay) {
      handleLearnDay(matchingDay.day_number);
      return;
    }

    // Fallback: use agent content directly
    if (hasAgent && topics.length > 0) {
      const idx = topics.findIndex((t: any) => t?.topic?.toLowerCase() === topicName?.toLowerCase());
      if (idx !== -1) {
        setActiveTopicIdx(idx);
        setActiveSubtopicIdx(0);
        setActiveSlideIdx(0);
        setIsIntroduced(true);
      }
    }
    setIsClassroomOpen(true);
  };

  // Auto-complete topic when reaching the last slide of the last subtopic of that topic
  useEffect(() => {
    if (isClassroomOpen && hasAgent && topics.length > 0) {
      const currentTopic = topics[activeTopicIdx];
      if (currentTopic) {
        const subtopics = currentTopic.subtopics || [];
        const isLastSubtopic = activeSubtopicIdx === subtopics.length - 1;
        if (isLastSubtopic && subtopics[activeSubtopicIdx]) {
          const slides = subtopics[activeSubtopicIdx]?.slides || [];
          const isLastSlide = activeSlideIdx === slides.length - 1;
          if (isLastSlide) {
            const topicName = currentTopic.topic;
            const batchId = batchDetails?.id || batchDetails?._id;
            const candidateId = candidate?.id || candidate?._id || user?.id;
            if (batchId && candidateId && topicName) {
              const key = `completed_topic_${batchId}_${candidateId}_${topicName}`;
              if (localStorage.getItem(key) !== 'true') {
                localStorage.setItem(key, 'true');
                toast.success(`Congratulations! You completed the topic "${topicName}".`);
                loadCompletions();
              }
            }
          }
        }
      }
    }
  }, [isClassroomOpen, hasAgent, activeTopicIdx, activeSubtopicIdx, activeSlideIdx, topics, batchDetails, candidate, user]);

  const handleStartTraining = () => {
    if (isPlanned) return;
    setIsClassroomOpen(true);
  };

  const formatDate = (date: Date | null) => {
    if (!date || isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString();
  };

  if (loading) {
    return <MorphLoader minHeight="60vh" text="Loading your classroom..." />;
  }

  if (!batchDetails) {
    return (
      <div className="card card-glow-orange" style={{ padding: 40, textAlign: 'center', maxWidth: 600, margin: '40px auto' }}>
        <AlertCircle size={40} color="var(--pale-orange)" style={{ margin: '0 auto 16px' }} />
        <h3 style={{ fontSize: 20, color: 'var(--text-primary)', fontWeight: 800 }}>No Cohort Assigned</h3>
        <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
          You are not currently assigned to any active training cohort. Please contact your coordinator to join a batch.
        </p>
      </div>
    );
  }

  const getTrainerName = () => {
    if (batchDetails.trainers && batchDetails.trainers.length > 0) {
      return batchDetails.trainers[0];
    }
    return 'Assigned Trainer';
  };

  // Classroom Render Logic
  if (isClassroomOpen) {
    if (!hasAgent) {
      // Trainer-led static details view
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }} className="fade-in">
          <button 
            onClick={() => setIsClassroomOpen(false)}
            className="slide-nav-btn"
            style={{ padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, borderRadius: 12, width: 'fit-content' }}
          >
            <ArrowLeft size={16} /> Back to Cohort Details
          </button>

          <div className="card card-glow-orange" style={{ padding: 32, textAlign: 'center', maxWidth: 800, margin: '20px auto' }}>
            <Award size={48} color="var(--pale-orange)" style={{ margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: 22, color: 'var(--text-primary)', fontWeight: 800 }}>Trainer-Led Training Cohort</h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: 12, fontSize: 15, lineHeight: 1.6 }}>
              Your training cohort is trainer-led. Your instructor, <strong>{getTrainerName()}</strong>, will conduct the training lectures live.
              Please check your daily calendar invite link or batch chat room details for live meeting coordinates.
            </p>

            <div style={{ marginTop: 32, textAlign: 'left' }}>
              <h4 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
                Course Topics to be Covered:
              </h4>
              <ul style={{ listStyleType: 'none', padding: 0, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {batchDetails.topics && batchDetails.topics.map((topic: string, index: number) => (
                  <li key={index} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14.5, color: 'var(--text-primary)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--pale-orange)' }} />
                    {topic}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      );
    }

    if (!isIntroduced) {
      // AI Agent Introduction Screen
      return (
        <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
          <style>{`
            @keyframes pulseGlow {
              0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(112, 214, 255, 0.4); }
              70% { transform: scale(1.06); box-shadow: 0 0 0 16px rgba(112, 214, 255, 0); }
              100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(112, 214, 255, 0); }
            }
            @keyframes rotateRing {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            .intro-avatar-pulse {
              position: relative;
              width: 100px;
              height: 100px;
              border-radius: 50%;
              background: var(--powder-blue);
              display: flex;
              align-items: center;
              justify-content: center;
              border: 3px solid var(--powder-blue);
            }
            .intro-avatar-ring {
              position: absolute;
              inset: -8px;
              border: 2px dashed rgba(112, 214, 255, 0.4);
              border-radius: 50%;
              animation: rotateRing 15s infinite linear;
            }
            .intro-speech-bubble {
              background: var(--bg-card);
              border: 1px solid var(--border-color);
              box-shadow: var(--shadow-card);
              backdrop-filter: var(--card-blur);
              border-radius: 20px;
              padding: 24px;
              max-width: 600px;
              text-align: center;
              margin-top: 28px;
              position: relative;
            }
            .intro-speech-bubble::before {
              content: '';
              position: absolute;
              top: -10px;
              left: 50%;
              transform: translateX(-50%);
              border-width: 0 10px 10px 10px;
              border-style: solid;
              border-color: transparent transparent var(--border-color) transparent;
            }
          `}</style>
          
          <div className="intro-avatar-pulse">
            <div className="intro-avatar-ring" />
            <Bot size={52} color="#ffffff" />
          </div>

          <div className="intro-speech-bubble">
            <h3 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
              {agentName} Appointed!
            </h3>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--text-primary)' }}>
              "Hello, <strong>{user?.fullName}</strong>! I am your AI Teaching Assistant appointed by your trainer <strong>{getTrainerName()}</strong>. 
              I will be teaching selected topics on scheduled days, while your trainer conducts the rest live. Let's head inside the classroom!"
            </p>
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 28 }}>
            <button 
              onClick={() => setIsClassroomOpen(false)}
              className="slide-nav-btn"
              style={{ padding: '12px 24px', fontSize: 14, borderRadius: 12, fontWeight: 600 }}
            >
              Cancel
            </button>
            <button 
              onClick={() => setIsIntroduced(true)}
              className="btn-primary"
              style={{ padding: '12px 28px', fontSize: 14, borderRadius: 12, fontWeight: 700 }}
            >
              Enter Classroom
            </button>
          </div>
        </div>
      );
    }

    // Interactive Slides Presentation View
    const isCurrentDayAiLed = isDayAiLed(activeDayNumber);
    const agentContent = batchDetails?.agent?.content || [];
    const matchingTopicIdx = agentContent.findIndex((t: any) => t.dayNumbers && t.dayNumbers.includes(activeDayNumber));
    const currentTopic = matchingTopicIdx !== -1 ? agentContent[matchingTopicIdx] : (topics[activeTopicIdx] || null);
    const currentSubtopic = currentTopic?.subtopics?.[activeSubtopicIdx];
    const currentSlide = currentSubtopic?.slides?.[activeSlideIdx];
    const totalSlides = currentSubtopic?.slides?.length || 0;
    const allScheduleDays = schedule.flatMap((w: any) => w.days || []);
    const currentDayInfo = allScheduleDays.find((d: any) => d.day_number === activeDayNumber);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '82vh' }} className="fade-in">
        <style>{`
          .preview-modal-card {
            background: rgba(255, 255, 255, 0.85);
            border: 1px solid rgba(168, 208, 230, 0.5);
            box-shadow: 0 25px 60px -15px rgba(135, 206, 235, 0.15);
            color: var(--text-primary);
            width: 100%;
            height: 100%;
            display: grid;
            grid-template-columns: 280px 1fr;
            gap: 24px;
            padding: 24px;
            position: relative;
            border-radius: 24px;
            backdrop-filter: blur(30px);
            font-family: 'Plus Jakarta Sans', sans-serif;
            transition: all 0.3s ease;
            box-sizing: border-box;
            overflow: hidden;
          }
          .dark .preview-modal-card {
            background: rgba(23, 28, 41, 0.85);
            border-color: rgba(255, 255, 255, 0.08);
            box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05);
          }

          .preview-sidebar {
            border-right: 1px solid rgba(168, 208, 230, 0.4);
            padding-right: 16px;
            display: flex;
            flex-direction: column;
            gap: 20px;
            overflow-y: auto;
            min-height: 0;
          }
          .dark .preview-sidebar {
            border-right-color: rgba(255, 255, 255, 0.08);
          }

          .preview-sidebar-title {
            font-size: 15px;
            font-weight: 800;
            color: var(--text-primary);
            line-height: 1.3;
          }
          .dark .preview-sidebar-title {
            color: #ffffff;
          }

          .preview-sidebar-subtitle {
            font-size: 11px;
            color: var(--text-secondary);
            margin-top: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .dark .preview-sidebar-subtitle {
            color: rgba(255, 255, 255, 0.4);
          }

          .subtopic-list-btn {
            background: transparent;
            border: 1px solid transparent;
            color: var(--text-secondary);
            padding: 8px 12px;
            border-radius: 10px;
            font-size: 12.5px;
            text-align: left;
            cursor: pointer;
            transition: all 0.25s ease;
            font-weight: 500;
            width: 100%;
          }
          .subtopic-list-btn:hover {
            background: rgba(135, 206, 235, 0.15);
            color: var(--text-primary);
          }
          .subtopic-list-btn.active {
            background: var(--powder-blue-glow);
            border: 1px solid var(--powder-blue);
            box-shadow: 0 4px 15px rgba(135, 206, 235, 0.1);
            color: var(--text-primary);
            font-weight: 700;
          }
          .dark .subtopic-list-btn {
            color: rgba(241, 245, 249, 0.55);
          }
          .dark .subtopic-list-btn:hover {
            background: rgba(255, 255, 255, 0.04);
            border-color: rgba(255, 255, 255, 0.05);
            color: #f8fafc;
          }
          .dark .subtopic-list-btn.active {
            background: rgba(112, 214, 255, 0.12);
            border: 1px solid rgba(112, 214, 255, 0.35);
            box-shadow: none;
            color: #ffffff;
          }

          .preview-breadcrumbs {
            font-size: 11px;
            font-weight: 700;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.8px;
          }
          .dark .preview-breadcrumbs {
            color: var(--powder-blue);
            text-shadow: 0 0 10px rgba(112, 214, 255, 0.15);
          }

          .preview-slide-title {
            font-size: 22px;
            font-weight: 800;
            color: var(--text-primary);
            margin-top: 6px;
            font-family: 'Plus Jakarta Sans', sans-serif;
          }
          .dark .preview-slide-title {
            color: #ffffff;
          }

          .preview-slide-card {
            background: #ffffff;
            border: 1px solid rgba(168, 208, 230, 0.5);
            border-radius: 20px;
            padding: 32px;
            width: 100%;
            max-width: 680px;
            min-height: 280px;
            box-shadow: 0 10px 30px rgba(135, 206, 235, 0.08);
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 14px;
            transition: all 0.3s ease;
          }
          .dark .preview-slide-card {
            background: var(--bg-card);
            border: 1px solid rgba(255, 255, 255, 0.06);
            box-shadow: none;
          }

          .preview-bullet-orb {
            display: inline-block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--pale-orange);
            box-shadow: none;
            margin-top: 9px;
            flex-shrink: 0;
          }
          .dark .preview-bullet-orb {
            box-shadow: 0 0 8px var(--pale-orange);
          }

          .preview-bullet-text {
            font-size: 14px;
            line-height: 1.6;
            color: var(--text-primary);
          }
          .dark .preview-bullet-text {
            color: rgba(255, 255, 255, 0.9);
          }

          .preview-code-block {
            background: #f8fafc;
            border: 1px solid rgba(168, 208, 230, 0.5);
            padding: 14px;
            border-radius: 12px;
            font-size: 12px;
            font-family: monospace;
            color: #0f172a;
            overflow-x: auto;
            text-align: left;
            margin: 10px 0;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
            max-width: 100%;
            width: 100%;
          }
          .dark .preview-code-block {
            background: rgba(8, 10, 15, 0.95);
            border: 1px solid rgba(112, 214, 255, 0.15);
            color: #f8fafc;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
          }

          .slide-nav-btn {
            background: rgba(0, 0, 0, 0.03);
            border: 1px solid rgba(0, 0, 0, 0.08);
            color: var(--text-primary);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: pointer;
          }
          .slide-nav-btn:hover:not(:disabled) {
            background: var(--powder-blue-glow);
            border-color: var(--powder-blue);
            color: var(--text-primary);
            transform: translateY(-1px);
          }
          .slide-nav-btn:active:not(:disabled) {
            transform: translateY(0);
          }
          .slide-nav-btn:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }
          .dark .slide-nav-btn {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #e2e8f0;
          }
          .dark .slide-nav-btn:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.25);
            color: #ffffff;
          }

          .preview-nav-indicator {
            font-size: 12.5px;
            font-weight: 700;
            color: var(--text-secondary);
          }
          .dark .preview-nav-indicator {
            color: rgba(255, 255, 255, 0.4);
          }

          .slide-sidebar-container::-webkit-scrollbar {
            width: 4px;
          }
          .slide-sidebar-container::-webkit-scrollbar-thumb {
            background: var(--text-muted);
            border-radius: 10px;
          }
          .slide-sidebar-container::-webkit-scrollbar-thumb:hover {
            background: var(--pale-orange);
          }
          .dark .slide-sidebar-container::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.15);
          }
          
          .preview-sidebar-topic {
            font-size: 10px; 
            font-weight: 800; 
            color: var(--pale-orange); 
            text-transform: uppercase; 
            letter-spacing: 0.8px;
          }
          .dark .preview-sidebar-topic {
            text-shadow: 0 0 10px rgba(255, 160, 89, 0.1);
          }
        `}</style>

        <div className="preview-modal-card">
          {/* Left Sidebar */}
          <div className="preview-sidebar slide-sidebar-container">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button 
                onClick={() => { setIsClassroomOpen(false); setIsIntroduced(false); }}
                style={{
                  background: 'rgba(255, 100, 100, 0.08)',
                  color: 'rgb(239, 68, 68)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: 10,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: 'fit-content',
                  marginBottom: 10
                }}
              >
                <ArrowLeft size={14} /> Exit Class
              </button>
              <h4 className="preview-sidebar-title">
                {batchDetails.batchName}
              </h4>
              <p className="preview-sidebar-subtitle">
                AI Agent Slide Curriculum
              </p>
            </div>

            {schedule.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {schedule.map((week: any) => (
                  <div key={week.week_number} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="preview-sidebar-topic">
                      Week {week.week_number}: {week.week_title}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4 }}>
                      {(week.days || []).map((day: any) => {
                        const isAi = isDayAiLed(day.day_number);
                        const isActive = activeDayNumber === day.day_number;
                        return (
                          <button
                            key={day.day_number}
                            onClick={() => {
                              setActiveDayNumber(day.day_number);
                              if (isAi) {
                                const tIdx = agentContent.findIndex((t: any) => t.dayNumbers && t.dayNumbers.includes(day.day_number));
                                if (tIdx !== -1) {
                                  setActiveTopicIdx(tIdx);
                                  setActiveSubtopicIdx(0);
                                  setActiveSlideIdx(0);
                                }
                              }
                            }}
                            className={`subtopic-list-btn ${isActive ? 'active' : ''}`}
                            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                                Day {day.day_number}
                              </span>
                              <span style={{
                                fontSize: 9, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 0.5,
                                padding: '1px 6px', borderRadius: 6,
                                background: isAi ? 'var(--powder-blue-glow)' : 'rgba(255, 160, 89, 0.08)',
                                color: isAi ? 'var(--powder-blue)' : 'var(--pale-orange)',
                                border: `1px solid ${isAi ? 'var(--powder-blue)' : 'var(--pale-orange)'}`,
                                marginLeft: 'auto', flexShrink: 0
                              }}>
                                {isAi ? `\u{1F916} ${agentName}` : `\u{1F468}\u{200D}\u{1F3EB} ${getTrainerName()}`}
                              </span>
                            </div>
                            <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-primary)' }}>
                              {day.topic}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {topics.map((topicItem: any, tIdx: number) => (
                  <div key={tIdx} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="preview-sidebar-topic">
                      Topic {tIdx + 1}: {topicItem.topic}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                      {topicItem?.subtopics?.map((subItem: any, sIdx: number) => {
                        const isSelected = activeTopicIdx === tIdx && activeSubtopicIdx === sIdx;
                        return (
                          <button
                            key={sIdx}
                            onClick={() => {
                              setActiveTopicIdx(tIdx);
                              setActiveSubtopicIdx(sIdx);
                              setActiveSlideIdx(0);
                            }}
                            className={`subtopic-list-btn ${isSelected ? 'active' : ''}`}
                          >
                            {subItem.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Subtopics list for AI days within active day */}
            {isCurrentDayAiLed && currentTopic && currentTopic.subtopics?.length > 1 && (
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 10, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>Subtopics</div>
                {currentTopic.subtopics.map((sub: any, sIdx: number) => (
                  <button
                    key={sIdx}
                    onClick={() => { setActiveSubtopicIdx(sIdx); setActiveSlideIdx(0); }}
                    className={`subtopic-list-btn ${activeSubtopicIdx === sIdx ? 'active' : ''}`}
                    style={{ fontSize: 11, padding: '5px 8px' }}
                  >
                    {sub.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Panel */}
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between', minHeight: 0 }}>
            {isCurrentDayAiLed && currentTopic ? (
              <>
                {/* Slide Header */}
                <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: 16 }}>
                  <div className="preview-breadcrumbs">
                    {currentTopic?.topic} &rsaquo; {currentSubtopic?.name}
                  </div>
                  <h3 className="preview-slide-title">
                    {currentSlide?.title}
                  </h3>
                </div>

                {/* Slide Content */}
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0',
                  overflowY: 'auto'
                }}>
                  <div className="preview-slide-card">
                    {currentSlide?.bullets?.map((bullet: string, bIdx: number) => (
                      <div key={bIdx} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <span className="preview-bullet-orb" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {bullet.includes('```') ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                              {bullet.split('```').map((part, idx) => {
                                if (idx % 2 === 1) {
                                  const codeText = part.trim();
                                  const lines = part.split('\n');
                                  const firstLine = lines[0].trim().toLowerCase();
                                  const knownLanguages = [
                                    'xml', 'html', 'css', 'javascript', 'js', 
                                    'typescript', 'ts', 'java', 'python', 'py', 
                                    'yaml', 'yml', 'json', 'sql', 'bash', 'sh', 
                                    'c', 'cpp', 'csharp'
                                  ];
                                  
                                  const isLanguageHeader = knownLanguages.includes(firstLine) || 
                                    (/^[a-zA-Z]{1,10}$/.test(firstLine) && lines.length > 1);

                                  let finalCode = '';
                                  if (isLanguageHeader) {
                                    finalCode = lines.slice(1).join('\n').trim();
                                  } else {
                                    finalCode = codeText;
                                    for (const lang of knownLanguages) {
                                      if (codeText.toLowerCase().startsWith(lang) && 
                                          !/^[a-zA-Z]+$/.test(codeText.slice(lang.length, lang.length + 1))) {
                                        finalCode = codeText.slice(lang.length).trim();
                                        break;
                                      }
                                    }
                                  }

                                  return (
                                    <pre key={idx} className="preview-code-block">
                                      <code>{finalCode}</code>
                                    </pre>
                                  );
                                }
                                return part.trim() ? <p key={idx} className="preview-bullet-text">{part}</p> : null;
                              })}
                            </div>
                          ) : (
                            <span className="preview-bullet-text">{bullet}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Slide Navigation */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 16
                }}>
                  <button
                    disabled={activeSlideIdx === 0}
                    onClick={() => setActiveSlideIdx(prev => prev - 1)}
                    className="slide-nav-btn"
                    style={{ padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 10 }}
                  >
                    <ChevronLeft size={16} /> Previous
                  </button>
                  <span className="preview-nav-indicator">
                    Slide {activeSlideIdx + 1} of {totalSlides}
                  </span>
                  <button
                    disabled={activeSlideIdx === totalSlides - 1}
                    onClick={() => setActiveSlideIdx(prev => prev + 1)}
                    className="slide-nav-btn"
                    style={{ padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 10 }}
                  >
                    Next <ChevronRight size={16} />
                  </button>
                </div>
              </>
            ) : (
              /* Trainer-Led Day View */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, textAlign: 'center', padding: 40 }}>
                <div style={{
                  width: 80, height: 80, borderRadius: '50%',
                  background: 'rgba(255, 160, 89, 0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '2px solid var(--pale-orange)'
                }}>
                  <User size={36} color="var(--pale-orange)" />
                </div>
                <div>
                  <h3 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
                    Trainer-Led Session
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 460 }}>
                    {currentDayInfo ? (
                      <>
                        <strong>Day {currentDayInfo.day_number}: {currentDayInfo.topic}</strong> is conducted live by your trainer <strong>{getTrainerName()}</strong>.
                        <br />Please join the scheduled live session or check your calendar for meeting coordinates.
                      </>
                    ) : (
                      <>This session is conducted live by your trainer <strong>{getTrainerName()}</strong>. Please check the calendar for details.</>
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }} className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <BookOpen size={28} color="var(--pale-orange)" />
        <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>My Trainings</h2>
      </div>

      {/* Cohort Card Layout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {allBatchesDetails.map((item, idx) => {
          const bData = item.batchData;
          const cand = item.cand;

          const start = bData?.startDate ? new Date(bData.startDate) : null;
          const end = bData?.endDate ? new Date(bData.endDate) : null;
          if (start) start.setHours(0, 0, 0, 0);
          if (end) end.setHours(0, 0, 0, 0);

          const isPlanned = !!(bData && bData.status === 'PLANNED' && start && now.getTime() < start.getTime());
          const isCompleted = !!(bData && (bData.status === 'COMPLETED' || (end && now.getTime() > end.getTime())));
          const isOngoing = !!(bData && !isPlanned && !isCompleted);

          const hasAgent = bData?.agent && bData.agent.status === 'ready';
          const agentName = bData?.agent?.agentName || 'AI Teaching Agent';

          const getTrainerName = () => {
            if (bData.trainers && bData.trainers.length > 0) {
              return bData.trainers[0];
            }
            return 'Assigned Trainer';
          };

          return (
            <div key={bData.id || bData._id || idx} className="card card-static" style={{ padding: 32, display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 32, borderRadius: 20 }}>
              {/* Left Side Info */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <span style={{ 
                    fontSize: 11, 
                    fontWeight: 800, 
                    color: isPlanned ? 'var(--yellow)' : isOngoing ? 'var(--powder-blue)' : 'var(--text-muted)',
                    background: isPlanned ? 'var(--yellow-glow)' : isOngoing ? 'var(--powder-blue-glow)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isPlanned ? 'var(--yellow)' : isOngoing ? 'var(--powder-blue)' : 'var(--border-color)'}`,
                    padding: '4px 10px',
                    borderRadius: 9999,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5
                  }}>
                    {bData.status}
                  </span>
                  <h3 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginTop: 12 }}>
                    {bData.batchName}
                  </h3>
                  <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                    Cohort ID: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{bData.batchId}</span>
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-primary)' }}>
                    <User size={16} color="var(--pale-orange)" />
                    <span>Assigned Instructor: <strong>{getTrainerName()}</strong></span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-primary)' }}>
                    <Calendar size={16} color="var(--powder-blue)" />
                    <span>Schedule: {formatDate(start)} &ndash; {formatDate(end)}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text-primary)' }}>
                    <Clock size={16} color="var(--yellow)" />
                    <span>
                      {isPlanned && start
                        ? `Training starts in ${Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))} days` 
                        : isOngoing 
                          ? 'Cohort session is currently Active' 
                          : 'Training cohort is Completed'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                  <button 
                    onClick={() => handleOpenCurriculum(item)}
                    className="slide-nav-btn"
                    style={{ padding: '12px 24px', fontSize: 14, borderRadius: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <BookOpen size={16} /> View Curriculum
                  </button>

                  <button 
                    onClick={() => handleOpenClassroom(item)}
                    disabled={isPlanned}
                    className={isPlanned ? 'slide-nav-btn' : 'btn-primary'}
                    style={{ 
                      padding: '12px 28px', 
                      fontSize: 14, 
                      borderRadius: 12, 
                      fontWeight: 700, 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 8,
                      cursor: isPlanned ? 'not-allowed' : 'pointer'
                    }}
                    title={isPlanned ? `Starts on ${formatDate(start)}` : ''}
                  >
                    <Play size={16} fill={!isPlanned ? "#ffffff" : "none"} /> Start Training
                  </button>
                </div>
              </div>

              {/* Right Side Agent Box */}
              <div style={{ 
                background: 'var(--powder-blue-glow)',
                border: '1px dashed var(--border-color)',
                borderRadius: 20,
                padding: 24,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                gap: 12
              }}>
                {hasAgent ? (
                  <>
                    <div style={{
                      width: 60, height: 60, borderRadius: '50%',
                      background: 'var(--powder-blue)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: 'none'
                    }}>
                      <Bot size={32} color="#ffffff" />
                    </div>
                    <div>
                      <h4 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{agentName}</h4>
                      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--powder-blue)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                        AI Assistant Appointed
                      </p>
                    </div>
                    <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      This cohort is powered by an AI Teaching Agent. The agent has generated slides and will act on behalf of your trainer to deliver this curriculum.
                    </p>
                  </>
                ) : (
                  <>
                    <div style={{
                      width: 60, height: 60, borderRadius: '50%',
                      background: 'rgba(255, 160, 89, 0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '2px solid var(--pale-orange)'
                    }}>
                      <User size={30} color="var(--pale-orange)" />
                    </div>
                    <div>
                      <h4 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Instructor-Led Session</h4>
                      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--pale-orange)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                        Live Classrooms
                      </p>
                    </div>
                    <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      Your instructor will lead live sessions to teach the topic outline. Ensure you attend classes and check messages for links.
                    </p>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>



      {/* Curriculum Modal */}
      {isCurriculumModalOpen && createPortal(
        <div className="curriculum-modal-overlay">
          <style>{`
            .curriculum-modal-overlay {
              position: fixed;
              inset: 0;
              background: rgba(15, 23, 42, 0.4);
              z-index: 1000;
              backdrop-filter: blur(20px);
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 24px;
              transition: all 0.3s ease;
            }
            .dark .curriculum-modal-overlay {
              background: rgba(8, 12, 24, 0.85);
            }

            .curriculum-modal-card {
              background: rgba(255, 255, 255, 0.9);
              border: 1px solid rgba(168, 208, 230, 0.5);
              box-shadow: 0 25px 60px -15px rgba(135, 206, 235, 0.15);
              color: var(--text-primary);
              width: 95%;
              max-width: 750px;
              max-height: 80vh;
              display: flex;
              flex-direction: column;
              gap: 20px;
              padding: 32px;
              position: relative;
              border-radius: 24px;
              backdrop-filter: blur(30px);
              font-family: 'Plus Jakarta Sans', sans-serif;
              transition: all 0.3s ease;
              box-sizing: border-box;
              overflow: hidden;
            }
            .dark .curriculum-modal-card {
              background: rgba(23, 28, 41, 0.9);
              border-color: rgba(255, 255, 255, 0.08);
              box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05);
            }

            .curriculum-close-btn {
              position: absolute;
              top: 20px;
              right: 20px;
              background: rgba(0, 0, 0, 0.04);
              border: 1px solid rgba(0, 0, 0, 0.08);
              width: 32px;
              height: 32px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: var(--text-secondary);
              cursor: pointer;
              z-index: 100;
              transition: all 0.2s;
            }
            .curriculum-close-btn:hover {
              background: rgba(0, 0, 0, 0.08);
              color: var(--text-primary);
            }
            .dark .curriculum-close-btn {
              background: rgba(255, 255, 255, 0.05);
              border-color: rgba(255, 255, 255, 0.08);
              color: rgba(255, 255, 255, 0.7);
            }
            .dark .curriculum-close-btn:hover {
              background: rgba(255, 255, 255, 0.15);
              color: #ffffff;
            }

            .curriculum-list-container {
              overflow-y: auto;
              display: flex;
              flex-direction: column;
              gap: 16px;
              padding-right: 6px;
              flex: 1;
              min-height: 0;
            }
          `}</style>
          
          <div className="curriculum-modal-card fade-in">
            <button className="curriculum-close-btn" onClick={() => setIsCurriculumModalOpen(false)}>
              <X size={16} />
            </button>

            <h3 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: 12, marginRight: 24 }}>
              Course Curriculum Outline
            </h3>
            
            <div className="curriculum-list-container slide-sidebar-container">
              {hasAgent ? (
                // Use Agent content structure if available
                topics.map((t: any, idx: number) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 800, color: 'var(--pale-orange)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Topic {idx + 1}: {t.topic}
                    </h4>
                    <ul style={{ listStyleType: 'none', paddingLeft: 12, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {t?.subtopics?.map((st: any, sIdx: number) => (
                        <li key={sIdx} style={{ fontSize: 13.5, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--powder-blue)' }} />
                          {st.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                // Use raw topics list
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Curriculum list specified by coordinator:</p>
                  <ul style={{ listStyleType: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {batchDetails.topics && batchDetails.topics.map((t: string, idx: number) => (
                      <li key={idx} style={{ fontSize: 14, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--pale-orange)' }} />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
