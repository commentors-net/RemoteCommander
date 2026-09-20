export const DESKTOP_VERSION = '1.0.0';
export const SUPPORTED_VIEWS = [
  'Chat',
  'Servers',
  'Terminal',
  'Files',
  'Activity',
  'Settings',
] as const;
export type ViewMode = (typeof SUPPORTED_VIEWS)[number];
