import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export type BackHandler = () => boolean | void;

class BackButtonManager {
  private handlers: BackHandler[] = [];
  private isListening = false;

  constructor() {
    this.init();
  }

  private init() {
    if (this.isListening || !Capacitor.isNativePlatform()) return;
    this.isListening = true;

    CapacitorApp.addListener('backButton', () => {
      // 依照 LIFO (後進先出) 順序呼叫最頂層的 handler
      for (let i = this.handlers.length - 1; i >= 0; i--) {
        const handler = this.handlers[i];
        const result = handler();
        if (result !== false) {
          // 被某個 handler 消費/處理了，停止向外冒泡
          return;
        }
      }

      // 如果堆疊中沒有任何 handler 處理，則直接退出 App
      CapacitorApp.exitApp();
    });
  }

  /**
   * 註冊一個返回鍵處理器，回傳取消註冊函數
   */
  register(handler: BackHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }
}

export const backButtonManager = new BackButtonManager();
