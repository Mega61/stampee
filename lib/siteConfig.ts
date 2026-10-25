const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, "");

const configuredAppUrl = import.meta.env.VITE_APP_URL?.trim();
const configuredSupportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim();

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";

export const APP_ORIGIN = normalizeOrigin(configuredAppUrl || window.location.origin);
export const SUPPORT_EMAIL = configuredSupportEmail || "";

export const buildAppUrl = (path = "/") => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${APP_ORIGIN}${normalizedPath}`;
};
