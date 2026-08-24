'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, FolderOpen, Film, Clock, Download, Play, Trash2, Sparkles, Loader2 } from 'lucide-react';
import { Dialog } from './Dialog';

interface SavedProjectsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadProject: (project: unknown) => void;
}

export const SavedProjectsDrawer: React.FC<SavedProjectsDrawerProps> = ({
  isOpen,
  onClose,
  onLoadProject
}) => {
  const [activeTab, setActiveTab] = useState<'projects' | 'exports'>('projects');
  const [projectsList, setProjectsList] = useState<any[]>([]);
  const [exportsList, setExportsList] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [projRes, expRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/exports')
      ]);

      if (projRes.ok) {
        const data = await projRes.json();
        setProjectsList(data.projects || []);
      }
      if (expRes.ok) {
        const data = await expRes.json();
        setExportsList(data.exports || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        fetchData();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, fetchData]);


  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      label="Saved projects and exports"
      placement="right"
      panelClassName="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl p-5 overflow-hidden"
    >
      <div className="contents">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <FolderOpen className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-slate-100 text-base">Saved Projects & Exports</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-950 p-1 rounded-xl my-4 border border-slate-800">
          <button
            onClick={() => setActiveTab('projects')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'projects' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Projects ({projectsList.length})
          </button>
          <button
            onClick={() => setActiveTab('exports')}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              activeTab === 'exports' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Rendered Videos ({exportsList.length})
          </button>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
              <span className="text-xs">Loading saved items...</span>
            </div>
          ) : activeTab === 'projects' ? (
            projectsList.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                No saved projects yet. Click &quot;Save Project&quot; in the studio!
              </div>
            ) : (
              projectsList.map((proj) => (
                <div
                  key={proj.id}
                  className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-amber-500/40 transition-all flex flex-col gap-2 group"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200 text-sm group-hover:text-amber-300 transition-colors">
                      {proj.title}
                    </span>
                    <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                      {proj.aspectRatio}
                    </span>
                  </div>

                  <div className="text-xs text-slate-400 flex items-center justify-between">
                    <span>{proj.surahNameEnglish} ({proj.surahNumber}:{proj.ayahStart}-{proj.ayahEnd})</span>
                    <span className="text-[10px] font-mono">{proj.reciterName}</span>
                  </div>

                  <button
                    onClick={() => {
                      onLoadProject(proj);
                      onClose();
                    }}
                    className="mt-1 w-full py-2 bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-200 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Open in Studio</span>
                  </button>
                </div>
              ))
            )
          ) : exportsList.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              No exported video clips yet. Click &quot;Export Video&quot; to render your first clip.
            </div>
          ) : (
            exportsList.map((exp) => (
              <div
                key={exp.id}
                className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200 text-sm">{exp.title}</span>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                    {exp.resolution}
                  </span>
                </div>

                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>GPU: {exp.gpuDevice || 'Unknown GPU'}</span>
                  <span className="font-mono text-slate-500">{exp.fps} FPS</span>
                </div>

                {exp.fileUrl && (
                  <a
                    href={exp.fileUrl}
                    download="QuranClip.mp4"
                    className="mt-1 w-full py-2 bg-emerald-500/20 hover:bg-emerald-500 hover:text-slate-950 text-emerald-300 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 border border-emerald-500/30"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download MP4 File</span>
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
};
