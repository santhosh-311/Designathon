import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, Send, Paperclip, Loader2, Bot, User, 
  ChevronDown, ChevronUp, FileSpreadsheet, Mail, 
  Database, RefreshCw, AlertCircle, CheckCircle, ArrowRight
} from 'lucide-react';
import api from '@/services/api';
import toast from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';

interface ThoughtLogItem {
  toolName: string;
  arguments: any;
  status: 'running' | 'success' | 'failed';
  result?: string;
  timestamp: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  thoughtLog?: ThoughtLogItem[];
  timestamp: Date;
  attachment?: {
    filename: string;
    filePath: string;
  };
}

export default function AssistantChatPage() {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hello! I am your Assistant, connected via Model Context Protocol (MCP).",
      timestamp: new Date()
    }
  ]);

  useEffect(() => {
    if (user) {
      const isAdmin = user.role === 'ADMIN';
      setMessages(prev => {
        if (prev.length <= 1) {
          return [
            {
              role: 'assistant',
              content: isAdmin
                ? "Hello! I am your Admin's Assistant, connected via Model Context Protocol (MCP). I can manage candidate records in PostgreSQL, parse uploaded spreadsheets, and send email notifications.\n\nWhat can I help you manage today?"
                : "Hello! I am your Coordinator Assistant, connected via Model Context Protocol (MCP). I can manage candidate records in PostgreSQL, parse uploaded spreadsheets, and send email notifications.\n\nWhat can I help you coordinate today?",
              timestamp: new Date()
            }
          ];
        }
        return prev;
      });
    }
  }, [user]);
  
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ filename: string; filePath: string } | null>(null);
  const [expandedThoughtIndex, setExpandedThoughtIndex] = useState<number | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSuggestionClick = (suggestion: string) => {
    setPrompt(suggestion);
  };

  // Upload Excel attachment
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      toast.error('Only Excel spreadsheets (.xlsx, .xls) and CSVs are supported.');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await api.post('/assistant/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setSelectedFile({
        filename: response.data.filename,
        filePath: response.data.filePath
      });
      toast.success('Spreadsheet uploaded and staged successfully!');
      
      // Auto append context in prompt
      setPrompt(prev => {
        const stageMsg = `[Staged File: ${response.data.filename}] `;
        return prev.includes(stageMsg) ? prev : stageMsg + prev;
      });
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.detail || 'Failed to upload spreadsheet.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Send message to assistant
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() && !selectedFile) return;

    const userMessageText = prompt.trim();
    const currentAttachment = selectedFile;
    
    // Add user message to UI
    const newUserMessage: Message = {
      role: 'user',
      content: userMessageText,
      timestamp: new Date(),
      attachment: currentAttachment || undefined
    };

    setMessages(prev => [...prev, newUserMessage]);
    setPrompt('');
    setSelectedFile(null);
    setLoading(true);

    try {
      // Map history to backend-friendly format (last 6 messages for context)
      const chatHistory = messages
        .slice(-6)
        .map(m => ({
          role: m.role,
          content: m.content
        }));

      // Call assistant chat endpoint
      const response = await api.post('/assistant/chat', {
        prompt: userMessageText + (currentAttachment ? ` (Local staged file path: ${currentAttachment.filePath})` : ''),
        chat_history: chatHistory
      });

      const reply: Message = {
        role: 'assistant',
        content: response.data.response,
        thoughtLog: response.data.thought_log,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, reply]);
      
      // Collapse previous thoughts and expand new ones if tools were used
      if (response.data.thought_log && response.data.thought_log.length > 0) {
        setExpandedThoughtIndex(messages.length + 1);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.response?.data?.detail || 'Assistant failed to respond.');
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "⚠️ Sorry, I encountered an error executing that request. Please make sure the Gemini API key is correctly configured and the database is accessible.",
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const parseInlineMarkdown = (text: string, isAssistantMessage: boolean = true): React.ReactNode[] => {
    if (!text) return [];
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} style={{ color: isAssistantMessage ? 'var(--powder-blue)' : '#ffffff', fontWeight: 700 }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={idx} style={{
            fontFamily: 'monospace',
            background: isAssistantMessage ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.15)',
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: 12,
            color: isAssistantMessage ? '#e2e8f0' : '#ffffff',
            border: isAssistantMessage ? '1px solid rgba(255, 255, 255, 0.05)' : '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  const parseMarkdownToJSX = (text: string, isAssistantMessage: boolean = true): React.ReactNode[] => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    
    let currentTableLines: string[] = [];
    let currentListLines: { type: 'ul' | 'ol', text: string }[] = [];
    let currentParagraphLines: string[] = [];
    
    const flushParagraph = (key: string | number) => {
      if (currentParagraphLines.length > 0) {
        elements.push(
          <p key={`p-${key}`} style={{
            margin: '4px 0',
            fontSize: 13,
            lineHeight: 1.6,
            color: isAssistantMessage ? 'var(--text-primary)' : '#ffffff'
          }}>
            {parseInlineMarkdown(currentParagraphLines.join(' '), isAssistantMessage)}
          </p>
        );
        currentParagraphLines = [];
      }
    };
    
    const flushList = (key: string | number) => {
      if (currentListLines.length > 0) {
        const type = currentListLines[0].type;
        const ListTag = type === 'ol' ? 'ol' : 'ul';
        elements.push(
          <ListTag key={`list-${key}`} style={{ paddingLeft: 20, margin: '6px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {currentListLines.map((item, idx) => (
              <li key={idx} style={{
                color: isAssistantMessage ? 'var(--text-primary)' : '#ffffff',
                fontSize: 13,
                listStyleType: type === 'ol' ? 'decimal' : 'disc'
              }}>
                {parseInlineMarkdown(item.text, isAssistantMessage)}
              </li>
            ))}
          </ListTag>
        );
        currentListLines = [];
      }
    };
    
    const flushTable = (key: string | number) => {
      if (currentTableLines.length > 0) {
        const lines = currentTableLines.map(l => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          const headers = lines[0].split('|').map(h => h.trim()).filter(h => h !== '');
          const rows = lines.slice(2).map(line => {
            const cells = line.split('|').map(cell => cell.trim());
            let filteredCells = [...cells];
            if (filteredCells[0] === '') filteredCells.shift();
            if (filteredCells[filteredCells.length - 1] === '') filteredCells.pop();
            return filteredCells;
          });
          
          elements.push(
            <div key={`table-${key}`} style={{ overflowX: 'auto', marginTop: 12, marginBottom: 12 }} className="custom-scrollbar">
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: 12,
                border: '1px solid var(--border-color)',
              }}>
                <thead>
                  <tr style={{ background: 'rgba(255, 255, 255, 0.05)', borderBottom: '1px solid var(--border-color)' }}>
                    {headers.map((h, idx) => (
                      <th key={idx} style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--powder-blue)', fontWeight: 700 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rIdx) => (
                    <tr key={rIdx} style={{ borderBottom: rIdx < rows.length - 1 ? '1px solid rgba(255, 255, 255, 0.03)' : 'none' }}>
                      {headers.map((_, cIdx) => (
                        <td key={cIdx} style={{ padding: '8px 14px', color: 'var(--text-primary)' }}>
                          {parseInlineMarkdown(row[cIdx] || '', isAssistantMessage)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        currentTableLines = [];
      }
    };
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (!trimmed) {
        flushParagraph(i);
        flushList(i);
        flushTable(i);
        continue;
      }
      
      if (trimmed.startsWith('|')) {
        flushParagraph(i);
        flushList(i);
        currentTableLines.push(line);
        continue;
      }
      
      const ulMatch = line.match(/^\s*[-*•]\s+(.*)/);
      const olMatch = line.match(/^\s*(\d+)\.\s+(.*)/);
      
      if (ulMatch) {
        flushParagraph(i);
        flushTable(i);
        currentListLines.push({ type: 'ul', text: ulMatch[1] });
        continue;
      } else if (olMatch) {
        flushParagraph(i);
        flushTable(i);
        currentListLines.push({ type: 'ol', text: olMatch[2] });
        continue;
      }
      
      flushList(i);
      flushTable(i);
      currentParagraphLines.push(trimmed);
    }
    
    flushParagraph('end');
    flushList('end');
    flushTable('end');
    
    return elements;
  };

  // Try parsing response if it contains JSON lists or tables
  const renderMessageContent = (content: string, isAssistantMessage: boolean = true) => {
    // Check if the content is pure JSON data representing a table
    if (content.trim().startsWith('[') || content.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Render as a beautiful glass table
          const headers = Object.keys(parsed[0]);
          return (
            <div style={{ overflowX: 'auto', marginTop: 12 }} className="custom-scrollbar">
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
                background: 'var(--bg-card)',
                borderRadius: 12,
                border: '1px solid var(--border-color)',
                backdropFilter: 'blur(10px)'
              }}>
                <thead>
                  <tr style={{ background: 'rgba(255, 255, 255, 0.05)', borderBottom: '1px solid var(--border-color)' }}>
                    {headers.map(h => (
                      <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: 'var(--powder-blue)', fontWeight: 700 }}>
                        {h.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: idx < parsed.length - 1 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none' }}>
                      {headers.map(h => {
                        const val = row[h];
                        return (
                          <td key={h} style={{ padding: '10px 16px', color: 'var(--text-primary)' }}>
                            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        } else if (typeof parsed === 'object') {
          // Single record object
          return (
            <div style={{
              background: 'var(--bg-card)',
              borderRadius: 12,
              padding: 16,
              border: '1px solid var(--border-color)',
              marginTop: 12,
              fontSize: 13,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12
            }}>
              {Object.entries(parsed).map(([key, val]) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: 'var(--powder-blue)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {key.replace(/([A-Z])/g, ' $1')}
                  </span>
                  <span style={{ color: 'var(--text-primary)', marginTop: 2, fontWeight: 600 }}>
                    {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                  </span>
                </div>
              ))}
            </div>
          );
        }
      } catch (e) {
        // Fall back to normal text if parsing fails
      }
    }

    // Standard markdown rendering backup
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {parseMarkdownToJSX(content, isAssistantMessage)}
      </div>
    );
  };

  const suggestions = [
    "List all training batches",
    "Analyze student attendance by email...",
    "Draft a warning email to test@student.com",
    "Who are the top performers in Batch 1?"
  ];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 120px)',
      gap: 16,
      maxWidth: '1200px',
      margin: '0 auto'
    }} className="fade-in">
      
      {/* Header Panel */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 24px',
        background: 'var(--powder-blue-glow)',
        border: '1px solid var(--border-color)',
        borderRadius: 20,
        boxShadow: 'var(--shadow-card)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14,
            background: 'var(--powder-blue)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'none'
          }}>
            <Sparkles size={22} color="#ffffff" />
          </div>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: -0.5 }}>
              {user?.role === 'ADMIN' ? "Admin's Assistant" : "Coordinator Assistant"}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
              MCP Server Status: Online (Gmail / PostgreSQL / Excel integrations active)
            </p>
          </div>
        </div>
      </div>

      {/* Chat Messages Log */}
      <div 
        style={{
          flex: 1,
          borderRadius: 24,
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          overflowY: 'auto',
          boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.05)',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-main)'
        }} 
        className="custom-scrollbar theme-reset"
      >
        
        {messages.map((msg, index) => {
          const isAssistant = msg.role === 'assistant';
          return (
            <div key={index} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isAssistant ? 'flex-start' : 'flex-end',
              gap: 8,
              maxWidth: '85%',
              alignSelf: isAssistant ? 'flex-start' : 'flex-end'
            }}>
              
              {/* Message bubble card */}
              <div style={{
                display: 'flex',
                gap: 12,
                flexDirection: isAssistant ? 'row' : 'row-reverse',
                alignItems: 'flex-start'
              }}>
                {/* Avatar */}
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: isAssistant ? 'var(--powder-blue)' : 'var(--pale-orange)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: 'none'
                }}>
                  {isAssistant ? <Bot size={18} color="#fff" /> : <User size={18} color="#fff" />}
                </div>

                {/* Content Bubble */}
                <div style={{
                  background: isAssistant ? 'var(--bg-card)' : 'var(--powder-blue)',
                  border: isAssistant ? '1px solid var(--border-color)' : '1px solid var(--powder-blue)',
                  borderRadius: 18,
                  padding: '14px 18px',
                  color: isAssistant ? 'var(--text-primary)' : '#ffffff',
                  boxShadow: 'var(--shadow-card)',
                }}>
                  {/* Staged file attachment tag */}
                  {msg.attachment && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'rgba(255, 255, 255, 0.1)',
                      padding: '6px 12px',
                      borderRadius: 8,
                      marginBottom: 10,
                      fontSize: 12,
                      border: '1px solid rgba(255, 255, 255, 0.15)'
                    }}>
                      <FileSpreadsheet size={16} color="#10b981" />
                      <span style={{ fontWeight: 600 }}>{msg.attachment.filename}</span>
                    </div>
                  )}
                  {renderMessageContent(msg.content, isAssistant)}
                </div>
              </div>
            </div>
          );
        })}

        {/* Loading placeholder */}
        {loading && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', alignSelf: 'flex-start' }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'var(--powder-blue)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Bot size={18} color="#fff" />
            </div>
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 18,
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--text-primary)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
              backdropFilter: 'blur(10px)'
            }}>
              <Loader2 className="animate-spin" size={18} color="var(--powder-blue)" />
              <span>Thinking & executing MCP tools...</span>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion Chips */}
      {messages.length === 1 && !loading && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '0 4px' }}>
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => handleSuggestionClick(s)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: 99,
                padding: '8px 16px',
                fontSize: 12,
                color: 'var(--text-primary)',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--powder-blue)';
                e.currentTarget.style.color = '#ffffff';
                e.currentTarget.style.borderColor = 'var(--powder-blue)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-card)';
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
            >
              {s}
              <ArrowRight size={12} />
            </button>
          ))}
        </div>
      )}

      {/* Input Tray */}
      <form onSubmit={handleSendMessage} className="theme-reset" style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 24,
        padding: '12px 16px',
        boxShadow: 'var(--shadow-card)',
        backdropFilter: 'blur(10px)'
      }}>
        {/* Attachment preview */}
        {selectedFile && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            padding: '8px 16px',
            borderRadius: 12,
            fontSize: 13
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ffffff' }}>
              <FileSpreadsheet size={18} color="#10b981" />
              <span style={{ fontWeight: 700 }}>Staged Excel File: {selectedFile.filename}</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                fontWeight: 700
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
            >
              Remove
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* File Upload Trigger */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || uploading}
            style={{
              background: 'rgba(0, 0, 0, 0.03)',
              border: '1px solid var(--border-color)',
              borderRadius: 14,
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              transition: 'all 0.2s',
              flexShrink: 0
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--powder-blue-glow)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(0, 0, 0, 0.03)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            title="Upload Candidate Excel Spreadsheet"
          >
            {uploading ? <Loader2 className="animate-spin" size={20} /> : <Paperclip size={20} />}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            accept=".xlsx,.xls,.csv"
          />

          {/* Prompt Input */}
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Type your command (e.g. 'Show toppers for batch Python1', 'Import this excel list')..."
            disabled={loading}
            className="glass-input"
            style={{
              flex: 1,
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              fontSize: 14,
              color: 'var(--text-primary)',
              outline: 'none'
            }}
          />

          {/* Send Trigger */}
          <button
            type="submit"
            disabled={loading || (!prompt.trim() && !selectedFile)}
            style={{
              background: (loading || (!prompt.trim() && !selectedFile)) ? 'var(--border-color)' : 'var(--powder-blue)',
              border: 'none',
              borderRadius: 14,
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: (loading || (!prompt.trim() && !selectedFile)) ? 'not-allowed' : 'pointer',
              color: (loading || (!prompt.trim() && !selectedFile)) ? 'var(--text-muted)' : '#ffffff',
              transition: 'all 0.2s',
              boxShadow: 'none',
              flexShrink: 0
            }}
            onMouseEnter={(e) => {
              if (!(loading || (!prompt.trim() && !selectedFile))) {
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(30, 64, 175, 0.4)';
              }
            }}
            onMouseLeave={(e) => {
              if (!(loading || (!prompt.trim() && !selectedFile))) {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}
