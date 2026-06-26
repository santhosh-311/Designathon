import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import { useAuth } from '@/context/AuthContext';
import FirstTimePasswordReset from '@/components/FirstTimePasswordReset';

export default function DashboardLayout() {
  const { user } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('mep-theme') as 'light' | 'dark') || 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    try {
      localStorage.setItem('mep-theme', theme);
    } catch {}
  }, [theme]);

  const handleToggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    try {
      localStorage.setItem('sidebar_collapsed', String(newState));
    } catch {}
  };

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };


  return (
    <ProtectedRoute>
      <div style={{ 
        display: 'flex', 
        minHeight: '100vh', 
        background: 'var(--bg-page-gradient)', 
        backgroundAttachment: 'fixed',
        color: 'var(--text-primary)',
        transition: 'background 0.3s ease, color 0.3s ease',
        position: 'relative'
      }}>
        {/* Background shapes for premium visual design */}
        <div style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'hidden',
          opacity: theme === 'light' ? 0.75 : 0.25,
          transition: 'opacity 0.3s ease'
        }}>
          {/* Subtle grid pattern */}
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: theme === 'light' 
              ? 'radial-gradient(circle, rgba(60, 44, 218, 0.035) 1.5px, transparent 1.5px)' 
              : 'radial-gradient(circle, rgba(60, 44, 218, 0.05) 1.5px, transparent 1.5px)',
            backgroundSize: '24px 24px',
          }} />

          {/* Large soft color blobs */}
          <div style={{
            position: 'absolute',
            top: '-10%',
            right: '-10%',
            width: '50vw',
            height: '50vw',
            borderRadius: '50%',
            background: theme === 'light' ? 'rgba(60, 44, 218, 0.04)' : 'rgba(60, 44, 218, 0.03)',
            filter: 'blur(100px)',
          }} />
          <div style={{
            position: 'absolute',
            bottom: '-10%',
            left: '-10%',
            width: '60vw',
            height: '60vw',
            borderRadius: '50%',
            background: theme === 'light' ? 'rgba(74, 144, 226, 0.04)' : 'rgba(96, 165, 250, 0.02)',
            filter: 'blur(120px)',
          }} />

          {/* Abstract SVG shapes */}
          <svg style={{
            position: 'absolute',
            top: '20%',
            left: '3%',
            width: '120px',
            height: '120px',
            opacity: 0.8,
            color: theme === 'light' ? 'rgba(60, 44, 218, 0.03)' : 'rgba(255, 255, 255, 0.02)'
          }} fill="none" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" />
          </svg>

          <svg style={{
            position: 'absolute',
            bottom: '20%',
            right: '5%',
            width: '160px',
            height: '160px',
            opacity: 0.8,
            color: theme === 'light' ? 'rgba(74, 144, 226, 0.03)' : 'rgba(255, 255, 255, 0.015)'
          }} fill="none" viewBox="0 0 100 100">
            <rect x="10" y="10" width="80" height="80" rx="10" stroke="currentColor" strokeWidth="2" strokeDasharray="10 5" transform="rotate(15 50 50)" />
          </svg>

          <svg style={{
            position: 'absolute',
            top: '45%',
            right: '20%',
            width: '80px',
            height: '80px',
            opacity: 0.6,
            color: theme === 'light' ? 'rgba(60, 44, 218, 0.03)' : 'rgba(255, 255, 255, 0.02)'
          }} fill="none" viewBox="0 0 100 100">
            <polygon points="50,15 90,85 10,85" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4" transform="rotate(45 50 50)" />
          </svg>
        </div>

        <Sidebar isCollapsed={isCollapsed} onToggle={handleToggleCollapse} theme={theme} />
        <div style={{ 
          flex: 1, 
          marginLeft: isCollapsed ? 120 : 300, 
          display: 'flex', 
          flexDirection: 'column',
          transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          zIndex: 1
        }}>
          <TopBar theme={theme} onToggleTheme={handleToggleTheme} />
          <main style={{ 
            flex: 1, 
            padding: '24px 32px 32px', 
            overflow: 'auto' 
          }}>
            <Outlet />
          </main>
        </div>
        {user?.isFirstLogin && user?.role !== 'ADMIN' && <FirstTimePasswordReset />}
      </div>
    </ProtectedRoute>
  );
}

