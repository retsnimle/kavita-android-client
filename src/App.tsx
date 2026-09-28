import React, { useState, useEffect } from 'react';
import { BookOpen, FolderDown, Settings } from 'lucide-react';
import { kavitaClient } from './api/kavitaClient';
import { LoginView } from './features/auth/LoginView';
import { LibraryView } from './features/library/LibraryView';
import { OfflineShelfView } from './features/offline/OfflineShelfView';
import { ComicReader } from './features/comic-reader/ComicReader';
import { EpubReader } from './features/epub-reader/EpubReader';
import { progressReconciler } from './core/sync/reconciler';
import { db } from './core/database/db';
import { backButtonManager } from './core/navigation/backButtonManager';

type Tab = 'library' | 'offline' | 'settings';


interface ActiveReaderState {
  seriesId: number;
  seriesName: string;
  volumeId: number;
  chapterId: number;
  chapterTitle: string;
  format: 'comic' | 'epub';
}

export const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<Tab>('library');
  const [activeReader, setActiveReader] = useState<ActiveReaderState | null>(null);
  const [pendingQueueCount, setPendingQueueCount] = useState<number>(0);

  const refreshQueueCount = async () => {
    const count = await db.progress_queue.count();
    setPendingQueueCount(count);
  };

  useEffect(() => {
    const isConfigured = kavitaClient.isConfigured();
    setIsAuthenticated(isConfigured);

    // 啟動時若有連線，自動在背景對齊離線佇列
    if (isConfigured) {
      progressReconciler.reconcileProgressQueue().then(() => {
        refreshQueueCount();
      }).catch(() => {});
    }

    // 監聽待同步離線佇列數量
    refreshQueueCount();
    const interval = setInterval(refreshQueueCount, 3000);
    return () => clearInterval(interval);
  }, []);

  // 監聽 Android 返回鍵：若非在線書庫 Tab 則返回書庫首頁
  useEffect(() => {
    if (activeTab === 'library') return;
    const unregister = backButtonManager.register(() => {
      setActiveTab('library');
      return true;
    });
    return unregister;
  }, [activeTab]);


  const handleLogout = () => {
    localStorage.removeItem('kavita_token');
    localStorage.removeItem('kavita_api_key');
    setIsAuthenticated(false);
  };

  const handleOpenReader = (params: ActiveReaderState) => {
    setActiveReader(params);
  };

  const handleCloseReader = () => {
    setActiveReader(null);
  };

  if (!isAuthenticated) {
    return <LoginView onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-white overflow-hidden">
      {/* 主要內容區域 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {activeTab === 'library' && <LibraryView onOpenReader={handleOpenReader} />}
        {activeTab === 'offline' && <OfflineShelfView onOpenReader={handleOpenReader} />}
        {activeTab === 'settings' && (
          <div className="flex-1 p-6 overflow-y-auto max-w-md mx-auto w-full flex flex-col space-y-6">
            <h1 className="text-xl font-bold mt-4">設定與連線資訊</h1>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col space-y-3">
              <div className="text-xs text-zinc-400">目前伺服器</div>
              <div className="text-sm font-mono text-emerald-400 break-all">
                {kavitaClient.getBaseUrl() || '未設定'}
              </div>
              <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
                <span>離線進度自動同步</span>
                <span className="font-mono text-zinc-300">
                  {pendingQueueCount > 0 ? `佇列暫存 ${pendingQueueCount} 筆 (聯網自動同步)` : '全部已對齊'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                離線時閱讀進度會暫存於本機。一旦連上網路，系統將在翻閱書籍或開啟 App 時自動於背景無感對齊。
              </p>
            </div>

            <button
              onClick={handleLogout}
              className="w-full py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold rounded-xl transition-colors border border-rose-500/20"
            >
              登出伺服器
            </button>
          </div>
        )}
      </div>

      {/* 底部導航欄 */}
      <div
        className="bg-zinc-900/90 backdrop-blur-md border-t border-zinc-800 flex items-center justify-around py-2 px-4 z-30"
        style={{ paddingBottom: 'calc(var(--sab) + 0.5rem)' }}
      >
        <button
          onClick={() => setActiveTab('library')}
          className={`flex flex-col items-center space-y-1 py-1 px-3 rounded-xl transition-colors ${
            activeTab === 'library' ? 'text-emerald-400 font-bold' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          <span className="text-[10px]">在線書庫</span>
        </button>

        <button
          onClick={() => setActiveTab('offline')}
          className={`flex flex-col items-center space-y-1 py-1 px-3 rounded-xl transition-colors ${
            activeTab === 'offline' ? 'text-emerald-400 font-bold' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <FolderDown className="w-5 h-5" />
          <span className="text-[10px]">離線沙盒</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center space-y-1 py-1 px-3 rounded-xl transition-colors ${
            activeTab === 'settings' ? 'text-emerald-400 font-bold' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px]">設定</span>
        </button>
      </div>

      {/* 全螢幕閱讀器喚起 */}
      {activeReader && (
        activeReader.format === 'comic' ? (
          <ComicReader
            seriesId={activeReader.seriesId}
            seriesName={activeReader.seriesName}
            volumeId={activeReader.volumeId}
            chapterId={activeReader.chapterId}
            chapterTitle={activeReader.chapterTitle}
            onClose={handleCloseReader}
          />
        ) : (
          <EpubReader
            seriesId={activeReader.seriesId}
            seriesName={activeReader.seriesName}
            volumeId={activeReader.volumeId}
            chapterId={activeReader.chapterId}
            chapterTitle={activeReader.chapterTitle}
            onClose={handleCloseReader}
          />
        )
      )}
    </div>
  );
};

export default App;
