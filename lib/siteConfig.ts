const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, "");

const configuredAppUrl = import.meta.env.VITE_APP_URL?.trim();
const configuredSupportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim();

export const APP_ORIGIN = normalizeOrigin(configuredAppUrl || "https://stampee.co");
export const SUPPORT_EMAIL = configuredSupportEmail || "hello@stampee.co";
export const SALES_EMAIL = "hello@stampee.co";

export const buildAppUrl = (path = "/") => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${APP_ORIGIN}${normalizedPath}`;
};
