/** Мелкие утилиты для DOM-слоя. */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char);
}

export function nl2br(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(timestamp: number): string {
  try {
    return dateFormatter.format(new Date(timestamp));
  } catch {
    return '';
  }
}

export function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Не найден элемент: ${selector}`);
  return element;
}
