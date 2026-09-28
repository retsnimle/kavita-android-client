import React, { useState } from 'react';
import { Server, Key, User, Lock, ArrowRight } from 'lucide-react';
import { kavitaClient } from '../../api/kavitaClient';
import { db } from '../../core/database/db';

interface LoginViewProps {
  onLoginSuccess: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [baseUrl, setBaseUrl] = useState(
    localStorage.getItem('kavita_base_url') || 'http://localhost:5000'
  );
  const [authMode, setAuthMode] = useState<'password' | 'apiKey'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState(localStorage.getItem('kavita_api_key') || '');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    try {
      kavitaClient.setServer(baseUrl);

      if (authMode === 'password') {
        if (!username || !password) throw new Error('請輸入使用者名稱與密碼');
        await kavitaClient.login(username, password);
      } else {
        if (!apiKey) throw new Error('請輸入 API Key');
        await kavitaClient.authenticateApiKey(apiKey);
      }

      // 儲存至本地伺服器清單
      const serverId = btoa(baseUrl);
      await db.servers.put({
        id: serverId,
        name: 'My Kavita Server',
        baseUrl,
        username: authMode === 'password' ? username : undefined,
        apiKey: authMode === 'apiKey' ? apiKey : undefined,
        isActive: true,
      });

      onLoginSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || '連線至 Kavita 伺服器失敗');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center px-4 py-8 text-zinc-100">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-400 mb-3 shadow-inner">
            <Server className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">連接 Kavita 伺服器</h1>
          <p className="text-xs text-zinc-400 mt-1">打造極致沉浸的 Android 離線閱讀體驗</p>
        </div>

        {errorMsg && (
          <div className="mb-5 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center space-x-2">
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
          {/* 伺服器網址 */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">伺服器位址 (URL)</label>
            <div className="relative">
              <Server className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://192.168.1.100:5000"
                required
                className="w-full pl-9 pr-3 py-2 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          {/* 認證模式切換 */}
          <div className="flex bg-zinc-800/70 p-1 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setAuthMode('password')}
              className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
                authMode === 'password'
                  ? 'bg-zinc-700 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              帳號密碼登入
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('apiKey')}
              className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
                authMode === 'apiKey'
                  ? 'bg-zinc-700 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              API Key 認證
            </button>
          </div>

          {authMode === 'password' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">使用者名稱</label>
                <div className="relative">
                  <User className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    className="w-full pl-9 pr-3 py-2 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">密碼</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Kavita API Key</label>
              <div className="relative">
                <Key className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Kavita API Key"
                  className="w-full pl-9 pr-3 py-2 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold rounded-xl text-sm flex items-center justify-center space-x-2 transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
          >
            {isLoading ? (
              <span>連線中...</span>
            ) : (
              <>
                <span>連線並進入書庫</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
