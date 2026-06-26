import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, Bot, Sun, Moon, Zap, ChevronRight, Home, X, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useLocation, Link } from 'react-router-dom';
import api from '@/services/api';
import toast from 'react-hot-toast';
import CustomSelect from '@/components/CustomSelect';
import ProfileDropdown from '@/components/layout/ProfileDropdown';

interface TopBarProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export default function TopBar({ theme, onToggleTheme }: TopBarProps) {
  const { user } = useAuth();
  const location = useLocation();

  const getBreadcrumbTitle = (segment: string) => {
    const titleMap: { [key: string]: string } = {
      'dashboard': 'Dashboard',
      'onboarding': 'Onboarding',
      'batches': 'Batches',
      'attendance': 'Attendance',
      'assessments': 'Assessments',
      'feedback': 'Feedback',
      'form': 'Form',
      'reports': 'Reports',
      'users': 'Users',
      'leaderboard': 'Leaderboard',
      'analytics': 'Analytics',
      'chat': 'Chat',
      'assistant-chat': 'Assistant Chat',
      'settings': 'Settings',
      'settings-diagnostics': 'Diagnostics',
      'my-agents': 'My Agents',
      'my-trainings': 'My Trainings',
      'profile': 'Personal Profile',
      'change-password': 'Change Password',
      'activity-logs': 'User Activity Logs'
    };
    return titleMap[segment.toLowerCase()] || segment.replace(/-/g, ' ');
  };

  const getBreadcrumbs = () => {
    const rawPath = location.pathname.toLowerCase();
    const items = [
      { title: 'Dashboard', url: '/dashboard', isLast: false }
    ];

    if (rawPath === '/dashboard' || rawPath === '/') {
      items[0].isLast = true;
    } else if (rawPath === '/settings-diagnostics') {
      items.push({ title: 'Settings', url: '/settings', isLast: false });
      items.push({ title: 'Diagnostics', url: '/settings-diagnostics', isLast: true });
    } else if (rawPath === '/feedback/form') {
      items.push({ title: 'Feedback', url: '/feedback', isLast: false });
      items.push({ title: 'Evaluation Form', url: '/feedback/form', isLast: true });
    } else if (rawPath === '/settings' && user?.role === 'TRAINEE') {
      const activeTab = location.state?.activeTab || 'profile';
      const title = activeTab === 'security' ? 'Change Password' : 'Personal Profile';
      items.push({ title, url: '/settings', isLast: true });
    } else {
      const pathnames = location.pathname.split('/').filter((x) => x);
      pathnames.forEach((segment, index) => {
        // De-duplicate if the user manually added subroutes
        if (segment.toLowerCase() !== 'dashboard') {
          const url = `/${pathnames.slice(0, index + 1).join('/')}`;
          items.push({
            title: getBreadcrumbTitle(segment),
            url,
            isLast: index === pathnames.length - 1
          });
        }
      });
    }

    return items.map((item, idx) => ({
      ...item,
      isLast: idx === items.length - 1
    }));
  };

  const breadcrumbs = getBreadcrumbs();
  const isDashboard = location.pathname === '/dashboard';
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();

  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);

  const [myCandidates, setMyCandidates] = useState<any[]>([]);
  const [activeBatchId, setActiveBatchId] = useState('');

  // Gamification state
  const [bitsAccumulated, setBitsAccumulated] = useState(0);
  const [bytesTotal, setBytesTotal] = useState(0);
  const [isPermanentEmployee, setIsPermanentEmployee] = useState(false);
  const [pointsLedger, setPointsLedger] = useState<any[]>([]);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);



  // ── Trainee cohort fetch ────────────────────────────────────────────────────
  useEffect(() => {
    const fetchTraineeCandidates = async () => {
      if (user?.role === 'TRAINEE') {
        try {
          const res = await api.get('/users/me/candidates');
          let data = res.data || [];

          if (user?.email === 'arunodayashine@gmail.com') {
            const pythonBatchId = 'fe0e6972-51de-4eec-8cf7-ff54863bb099';
            const hasPythonBatch = data.some((c: any) => c.batchId === pythonBatchId);
            if (!hasPythonBatch) {
              data.push({
                id: 'cff51548-a0b1-4fb7-bc86-f20fa4e04460',
                email: 'arunodayashine@gmail.com',
                fullName: 'Aruna Grandhi',
                registrationNumber: 'MAV-001-STREAM',
                batchId: pythonBatchId,
                phone: '+919845612378',
                performanceScore: 0,
                progress: { completed_days: [], current_day: 1 },
                batchName: 'Data Engineering - Python',
              });
            }
          }

          setMyCandidates(data);
          const stored = localStorage.getItem('active_trainee_batch_id');
          if (data.length > 0) {
            const isValid = data.some((c: any) => c.batchId === stored) || stored === 'ALL';
            let activeBatchIdToUse = '';
            if (isValid && stored) {
              setActiveBatchId(stored);
              activeBatchIdToUse = stored;
            } else {
              const defaultBatch = data[0].batchId;
              localStorage.setItem('active_trainee_batch_id', defaultBatch);
              setActiveBatchId(defaultBatch);
              activeBatchIdToUse = defaultBatch;
            }

            const activeCand = data.find((c: any) => c.batchId === activeBatchIdToUse) || data[0];
            if (activeCand) {
              setBitsAccumulated(activeCand.bitsAccumulated || activeCand.bits_accumulated || 0);
              setBytesTotal(activeCand.bytesTotal || activeCand.bytes_total || 0);
              setIsPermanentEmployee(activeCand.isPermanentEmployee || activeCand.is_permanent_employee || false);
            }
          }
        } catch (err) {
          console.error('Failed to load trainee cohorts:', err);
        }
      }
    };
    fetchTraineeCandidates();
  }, [user]);



  const handleBatchChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newBatchId = e.target.value;
    localStorage.setItem('active_trainee_batch_id', newBatchId);
    setActiveBatchId(newBatchId);
    toast.success('Switched active cohort context!');
    setTimeout(() => window.location.reload(), 500);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifDropdown(false);
      }
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setShowProfileDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatNotifTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <header style={{
      height: 72,
      padding: '0 28px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 30,
      background: 'var(--bg-card)',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      borderBottom: '1px solid var(--border-color)',
      borderTop: 'none',
      borderRadius: '0 0 24px 24px',
      boxShadow: theme === 'dark'
        ? '0 8px 32px rgba(0, 0, 0, 0.25), 0 0 15px rgba(112, 214, 255, 0.05)'
        : '0 8px 32px rgba(0, 0, 0, 0.05)',
      transition: 'background 0.3s ease, box-shadow 0.3s ease',
    }}>

      {/* ── Left: Breadcrumbs Navigation ─────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 13,
        fontWeight: 600,
        minWidth: 240,
      }}>
        <Link 
          to="/dashboard" 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 4, 
            color: 'var(--text-secondary)', 
            textDecoration: 'none',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
        >
          <Home size={14} style={{ opacity: 0.8 }} />
        </Link>

        {breadcrumbs.map((item) => (
          <React.Fragment key={item.url}>
            <ChevronRight size={13} color="var(--text-muted)" style={{ opacity: 0.5, flexShrink: 0 }} />
            {item.isLast ? (
              <span style={{ 
                color: 'var(--powder-blue)', 
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}>
                {item.title}
              </span>
            ) : (
              <Link 
                to={item.url} 
                style={{ 
                  color: 'var(--text-secondary)', 
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.2s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
              >
                {item.title}
              </Link>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* ── Center: Brand (absolutely centered) ──────────────────────────── */}
      <div style={{
        position: 'absolute',
        left: '46%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        pointerEvents: 'none',
      }}>
        <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'var(--powder-blue)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'none',
            flexShrink: 0,
          }}>
            <Zap size={18} color="#ffffff" strokeWidth={2.5} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{
              fontSize: 20, fontWeight: 800,
              color: 'var(--text-primary)',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
              letterSpacing: '-0.5px',
              lineHeight: 1.1,
            }}>
              Maverick One
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: 'var(--powder-blue)',
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              marginTop: 1,
            }}>
              Training Management System
            </span>
          </div>
        </div>
      </div>

      {/* ── Right: Actions ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>

        {/* BNB Points Widget */}
        {user?.role === 'TRAINEE' && (
          <div
            onClick={async () => {
              setShowLedgerModal(true);
              setLedgerLoading(true);
              try {
                const res = await api.get('/api/gamification/ledger');
                setPointsLedger(res.data || []);
              } catch (err) {
                console.warn('Failed to load points ledger:', err);
              } finally {
                setLedgerLoading(false);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 14,
              background: theme === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(112, 214, 255, 0.1)',
              border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(112, 214, 255, 0.25)',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              boxShadow: 'var(--shadow-card)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.borderColor = 'var(--yellow)';
              e.currentTarget.style.boxShadow = '0 0 12px rgba(255, 208, 0, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(112, 214, 255, 0.25)';
              e.currentTarget.style.boxShadow = 'var(--shadow-card)';
            }}
            title="View BNB Points Ledger"
          >
            <Zap size={14} color="var(--yellow)" fill="var(--yellow)" style={{ filter: 'drop-shadow(0 0 4px var(--yellow-glow))' }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              {bytesTotal}
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', marginLeft: 1 }}>B</span>
              <span style={{ margin: '0 3px', color: 'var(--text-muted)' }}>·</span>
              {bitsAccumulated}
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', marginLeft: 1 }}>b</span>
            </span>
            {isPermanentEmployee && (
              <span 
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  background: 'rgba(46, 204, 113, 0.15)', 
                  border: '1px solid #2ecc71',
                  borderRadius: 6, 
                  padding: '1px 4px',
                  fontSize: 8,
                  fontWeight: 900,
                  color: '#2ecc71',
                  textTransform: 'uppercase',
                  marginLeft: 2
                }}
                title="Full Time Employee (FTE)"
              >
                FTE
              </span>
            )}
          </div>
        )}

        {/* Theme Toggle Switch */}
        <div
          onClick={onToggleTheme}
          style={{
            width: 64, height: 34, borderRadius: 17,
            background: theme === 'dark' ? 'rgba(15, 23, 42, 0.4)' : 'rgba(226, 232, 240, 0.6)',
            border: theme === 'dark' ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(15, 23, 42, 0.08)',
            display: 'flex', alignItems: 'center',
            cursor: 'pointer',
            position: 'relative',
            backdropFilter: 'var(--card-blur)',
            boxShadow: theme === 'dark' 
              ? 'inset 0 2px 4px rgba(0,0,0,0.4), 0 1px 1px rgba(255,255,255,0.05)'
              : 'inset 0 2px 4px rgba(0,0,0,0.06), 0 1px 1px rgba(255,255,255,0.8)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            padding: 0,
            overflow: 'hidden',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(15, 23, 42, 0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.borderColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.08)';
          }}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
        >
          {/* Background Sun Icon (visible in dark mode when Moon knob moves to the right) */}
          <div style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: `translateY(-50%) ${theme === 'dark' ? 'scale(1)' : 'scale(0.8)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: theme === 'dark' ? 0.4 : 0,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: 'none',
          }}>
            <Sun size={14} color="#94a3b8" />
          </div>

          {/* Background Moon Icon (visible in light mode when Sun knob is on the left) */}
          <div style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: `translateY(-50%) ${theme === 'light' ? 'scale(1)' : 'scale(0.8)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: theme === 'light' ? 0.5 : 0,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: 'none',
          }}>
            <Moon size={14} color="#64748b" />
          </div>

          {/* Sliding Knob */}
          <div
            style={{
              width: 26, height: 26, borderRadius: '50%',
              background: theme === 'dark' 
                ? 'linear-gradient(135deg, #1e293b, #0f172a)' 
                : 'linear-gradient(135deg, #ffffff, #f8fafc)',
              position: 'absolute',
              left: 4,
              transform: theme === 'dark' ? 'translateX(30px)' : 'translateX(0px)',
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s ease, box-shadow 0.3s ease',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: theme === 'dark'
                ? '0 2px 8px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
                : '0 2px 8px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
            }}
          >
            {theme === 'dark' ? (
              <Moon size={14} color="#fcd34d" strokeWidth={2.5} style={{ filter: 'drop-shadow(0 0 2px rgba(252, 211, 77, 0.35))' }} />
            ) : (
              <Sun size={14} color="#f97316" strokeWidth={2.5} style={{ filter: 'drop-shadow(0 0 2px rgba(249, 115, 22, 0.25))' }} />
            )}
          </div>
        </div>

        {/* Notifications Bell */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <div
            onClick={() => setShowNotifDropdown(!showNotifDropdown)}
            style={{
              width: 44, height: 44, borderRadius: 14,
              background: unreadCount > 0 ? 'var(--pale-orange-glow)' : 'var(--bg-card)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', position: 'relative',
              border: unreadCount > 0 ? '1px solid var(--pale-orange)' : '1px solid var(--border-color)',
              backdropFilter: 'var(--card-blur)',
              boxShadow: 'var(--shadow-card)',
              transition: 'all 0.3s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.borderColor = 'var(--pale-orange)';
              e.currentTarget.style.boxShadow = '0 0 12px var(--pale-orange-glow)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.borderColor = unreadCount > 0 ? 'var(--pale-orange)' : 'var(--border-color)';
              e.currentTarget.style.boxShadow = 'var(--shadow-card)';
            }}
          >
            <Bell size={20} color={unreadCount > 0 ? 'var(--pale-orange)' : 'var(--text-secondary)'} />
            {unreadCount > 0 && (
              <div style={{
                position: 'absolute', top: -3, right: -3,
                minWidth: 18, height: 18, borderRadius: '50%',
                background: '#ff6b6b', border: '2px solid var(--bg-card)',
                color: '#fff', fontSize: 10, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 3px', boxShadow: '0 0 8px rgba(255, 107, 107, 0.4)',
              }}>
                {unreadCount}
              </div>
            )}
          </div>

          {showNotifDropdown && (
            <div style={{
              position: 'absolute', right: 0, top: 54, width: 340,
              background: 'var(--bg-card)', borderRadius: 18, border: '1px solid var(--border-color)',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.15)', overflow: 'hidden',
              backdropFilter: 'var(--card-blur)',
              animation: 'fadeIn 0.25s ease-out',
              zIndex: 50,
            }}>
              <div style={{
                padding: '16px 20px', borderBottom: '1px solid var(--border-color)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'rgba(135, 206, 235, 0.05)',
              }}>
                <h4 style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>Notifications</h4>
                {unreadCount > 0 && (
                  <button
                    onClick={() => { markAllAsRead(); setShowNotifDropdown(false); }}
                    style={{ border: 'none', background: 'transparent', color: 'var(--pale-orange)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Clear All
                  </button>
                )}
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                    <Bell size={28} color="var(--text-muted)" style={{ margin: '0 auto 8px' }} />
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>No notifications yet.</p>
                  </div>
                ) : (
                  <>
                    {notifications.slice(0, 5).map((notif) => (
                      <div key={notif.id} style={{
                        padding: '14px 20px', borderBottom: '1px solid var(--border-color)',
                        background: notif.is_read ? 'transparent' : 'var(--powder-blue-glow)',
                        display: 'flex', gap: 12, alignItems: 'flex-start', transition: 'background 0.2s',
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: notif.is_read ? 'transparent' : '#ff6b6b', marginTop: 6, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 12, fontWeight: notif.is_read ? 500 : 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>{notif.message}</p>
                          <span style={{ fontSize: 10, color: 'var(--text-secondary)', display: 'block', marginTop: 4 }}>{formatNotifTime(notif.created_at)}</span>
                        </div>
                        {!notif.is_read && (
                          <button
                            onClick={() => markAsRead(notif.id)}
                            style={{ border: 'none', background: 'var(--pale-orange-glow)', width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--pale-orange)' }}
                          >
                            <Check size={12} strokeWidth={2.5} />
                          </button>
                        )}
                      </div>
                    ))}
                    {notifications.length > 5 && (
                      <div style={{ padding: '12px 20px', textAlign: 'center', borderTop: '1px solid var(--border-color)', background: 'rgba(255, 165, 0, 0.03)' }}>
                        <span style={{ fontSize: 11, color: 'var(--pale-orange)', fontWeight: 700 }}>More than 5 activities. View all in the Recent Activities section.</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Avatar */}
        <div ref={profileDropdownRef} style={{ position: 'relative' }}>
          <div
            onClick={() => setShowProfileDropdown(!showProfileDropdown)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          >
            <div
              style={{
                width: 44, height: 44, borderRadius: 14,
                background: 'var(--powder-blue)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#ffffff', fontWeight: 800, fontSize: 16,
                boxShadow: 'none',
                transition: 'transform 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              {user?.fullName?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div style={{ display: 'none', md: 'block' } as any}>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>{user?.fullName || 'User'}</p>
              <p style={{ fontSize: 11, color: 'var(--pale-orange)', fontWeight: 700, letterSpacing: 0.5, lineHeight: 1.2 }}>{user?.role}</p>
            </div>
          </div>

          {showProfileDropdown && (
            <ProfileDropdown onClose={() => setShowProfileDropdown(false)} />
          )}
        </div>

      </div>

      {/* POINTS LEDGER MODAL */}
      {showLedgerModal && createPortal(
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: 24
          }}
          onClick={() => setShowLedgerModal(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: 520, width: '100%', maxHeight: '70vh',
              padding: 0, overflow: 'hidden',
              animation: 'fadeInUp 0.3s ease',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 18,
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px', borderBottom: '1px solid var(--border-color)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Zap size={20} color="var(--yellow)" fill="var(--yellow)" />
                <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', margin: 0, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Points Ledger</h3>
              </div>
              <button
                onClick={() => setShowLedgerModal(false)}
                style={{
                  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
                  borderRadius: 8, width: 32, height: 32, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text-secondary)'
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '16px 24px', overflowY: 'auto', maxHeight: 'calc(70vh - 80px)' }}>
              {/* Summary bar */}
              <div style={{
                display: 'flex', justifyContent: 'space-around', padding: '14px 16px',
                background: 'rgba(255, 208, 0, 0.04)', border: '1px solid rgba(255, 208, 0, 0.15)',
                borderRadius: 14, marginBottom: 20
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--yellow)' }}>{bytesTotal}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Total Bytes</div>
                </div>
                <div style={{ width: 1, background: 'var(--border-color)' }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{bitsAccumulated}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Current Bits</div>
                </div>
                <div style={{ width: 1, background: 'var(--border-color)' }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{8 - bitsAccumulated}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>To Next Byte</div>
                </div>
              </div>

              {/* Ledger Entries */}
              {ledgerLoading ? (
                <div style={{ textAlign: 'center', padding: 32 }}>
                  <Loader2 className="animate-spin" size={24} color="var(--yellow)" style={{ margin: '0 auto', display: 'inline-block' }} />
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12 }}>Loading transactions...</p>
                </div>
              ) : pointsLedger.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32 }}>
                  <AlertCircle size={28} color="var(--text-muted)" style={{ margin: '0 auto' }} />
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 12 }}>
                    No point transactions recorded yet.<br />Complete daily targets to earn bits!
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {pointsLedger.map((entry: any, idx: number) => (
                    <div
                      key={entry.id || idx}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '12px 16px', borderRadius: 12,
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid var(--border-color)'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{entry.reason}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(entry.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {' · '}
                          {new Date(entry.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <span style={{
                        fontSize: 15, fontWeight: 800,
                        color: 'var(--yellow)',
                        background: 'rgba(255, 208, 0, 0.08)',
                        padding: '4px 10px', borderRadius: 10
                      }}>
                        +{entry.amount_bits} bits
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
}
