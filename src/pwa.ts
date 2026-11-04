/** Регистрация service worker (PWA-офлайн). */
import { registerSW } from 'virtual:pwa-register';

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  try {
    registerSW({
      immediate: true,
      onRegisterError(error) {
        console.warn('[visual-lab] service worker не зарегистрирован', error);
      },
    });
  } catch (error) {
    console.warn('[visual-lab] PWA недоступна', error);
  }
}
