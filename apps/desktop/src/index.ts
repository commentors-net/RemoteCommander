export const DESKTOP_VERSION = '0.1.0';
export const SUPPORTED_VIEWS = [
  'Chat',
  'Servers',
  'Terminal',
  'Files',
  'Activity',
  'Settings',
] as const;
export type ViewMode = (typeof SUPPORTED_VIEWS)[number];
