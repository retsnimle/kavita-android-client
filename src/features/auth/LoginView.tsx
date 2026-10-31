import React, { useState } from 'react';
import { Server, Key, User, Lock, ArrowRight, Globe } from 'lucide-react';
import { kavitaClient } from '../../api/kavitaClient';
import { db } from '../../core/database/db';
import { useI18n } from '../../core/i18n';

interface LoginViewProps {
  onLoginSuccess: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const { t, locale, setLocale } = useI18n();
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
        if (!username || !password) throw new Error(t('auth.errorEmptyUserPass'));
        await kavitaClient.login(username, password);
      } else {
        if (!apiKey) throw new Error(t('auth.errorEmptyApiKey'));
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
      setErrorMsg(err.message || t('auth.errorConnectFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleLanguage = () => {
    setLocale(locale === 'zh-TW' ? 'en-US' : 'zh-TW');
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center px-4 py-8 text-zinc-100 relative">
      {/* 語言切換浮動按鈕 */}
      <button
        type="button"
        onClick={toggleLanguage}
        className="absolute top-4 right-4 flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
        style={{ marginTop: 'var(--sat)' }}
      >
        <Globe className="w-3.5 h-3.5" />
        <span>{locale === 'zh-TW' ? 'English' : '繁體中文'}</span>
      </button>

      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-400 mb-3 shadow-inner">
            <Server className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">{t('auth.title')}</h1>
          <p className="text-xs text-zinc-400 mt-1">{t('auth.subtitle')}</p>
        </div>

        {errorMsg && (
          <div className="mb-5 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center space-x-2">
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
          {/* 伺服器網址 */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">{t('auth.serverUrl')}</label>
            <div className="relative">
              <Server className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t('auth.serverUrlPlaceholder')}
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
              {t('auth.modePassword')}
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
              {t('auth.modeApiKey')}
            </button>
          </div>

          {authMode === 'password' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">{t('auth.username')}</label>
                <div className="relative">
                  <User className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('auth.usernamePlaceholder')}
                    className="w-full pl-9 pr-3 py-2 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">{t('auth.password')}</label>
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
              <label className="block text-xs font-medium text-zinc-300 mb-1">{t('auth.apiKey')}</label>
              <div className="relative">
                <Key className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('auth.apiKeyPlaceholder')}
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
              <span>{t('auth.connecting')}</span>
            ) : (
              <>
                <span>{t('auth.connectAndEnter')}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
