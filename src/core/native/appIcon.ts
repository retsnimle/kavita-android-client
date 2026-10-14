import { registerPlugin, Capacitor } from '@capacitor/core';

export type AppIconType = 'classic' | 'emblem';

interface AppIconPluginInterface {
  getAppIcon(): Promise<{ icon: AppIconType }>;
  setAppIcon(options: { icon: AppIconType }): Promise<{ success: boolean; icon: AppIconType }>;
}

const NativeAppIcon = registerPlugin<AppIconPluginInterface>('AppIcon');

const STORAGE_KEY = 'kavita_icon_mode';

function updateFavicon(icon: AppIconType) {
  const iconUrl = icon === 'emblem' ? '/icons/icon_emblem.png' : '/icons/icon_classic.png';
  let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'shortcut icon';
    document.getElementsByTagName('head')[0].appendChild(link);
  }
  link.type = 'image/png';
  link.href = iconUrl;
}

export const appIconManager = {
  async getCurrentIcon(): Promise<AppIconType> {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await NativeAppIcon.getAppIcon();
        if (res && (res.icon === 'classic' || res.icon === 'emblem')) {
          localStorage.setItem(STORAGE_KEY, res.icon);
          updateFavicon(res.icon);
          return res.icon;
        }
      } catch (err) {
        console.warn('[AppIcon] Failed to get native icon, fallback to localStorage', err);
      }
    }

    const saved = localStorage.getItem(STORAGE_KEY) as AppIconType | null;
    const current = saved === 'emblem' ? 'emblem' : 'classic';
    updateFavicon(current);
    return current;
  },

  async switchIcon(target: AppIconType): Promise<{ success: boolean; icon: AppIconType }> {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await NativeAppIcon.setAppIcon({ icon: target });
        localStorage.setItem(STORAGE_KEY, res.icon);
        updateFavicon(res.icon);
        return res;
      } catch (err) {
        console.error('[AppIcon] Native switch failed', err);
        throw err;
      }
    } else {
      localStorage.setItem(STORAGE_KEY, target);
      updateFavicon(target);
      return { success: true, icon: target };
    }
  }
};
