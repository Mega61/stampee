import React, { useEffect, useRef } from "react";
import { GOOGLE_CLIENT_ID } from "../lib/siteConfig";

// Hosted-domain hint passed to Google Identity Services. This is only a UI
// hint (it pre-filters the account chooser); the real domain enforcement
// happens server-side against the verified `hd` claim.
const WORKSPACE_DOMAIN = "goldenbeautystudio.com.co";
const GIS_SRC = "https://accounts.google.com/gsi/client";

// Minimal typings for the slice of Google Identity Services we use.
interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdConfig {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  hd?: string;
  auto_select?: boolean;
}

interface GoogleButtonOptions {
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "small" | "medium" | "large";
  width?: number;
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  locale?: string;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfig) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
  cancel: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleAccountsId;
      };
    };
  }
}

// Loads the GIS client script exactly once, reusing the in-flight promise on
// subsequent mounts so we never double-inject the <script> tag.
let gisLoader: Promise<void> | null = null;
const loadGisScript = (): Promise<void> => {
  if (typeof document === "undefined") return Promise.reject(new Error("no document"));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gisLoader) return gisLoader;

  gisLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google script")));
      if (window.google?.accounts?.id) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoader = null;
      reject(new Error("Failed to load Google script"));
    };
    document.head.appendChild(script);
  });
  return gisLoader;
};

interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void;
  text?: "signin_with" | "continue_with";
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({ onCredential, text }) => {
  const divRef = useRef<HTMLDivElement>(null);
  // Keep the latest callback without forcing a re-init when the parent rerenders.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    loadGisScript()
      .then(() => {
        if (cancelled) return;
        const id = window.google?.accounts?.id;
        if (!id || !divRef.current) return;
        id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => onCredentialRef.current(response.credential),
          hd: WORKSPACE_DOMAIN,
          auto_select: false,
        });
        id.renderButton(divRef.current, {
          theme: "outline",
          size: "large",
          width: 320,
          text: text ?? "signin_with",
          locale: "es",
        });
      })
      .catch(() => {
        // Graceful no-op: if the script fails to load, the password flow remains.
      });

    return () => {
      cancelled = true;
      window.google?.accounts?.id?.cancel();
    };
  }, [text]);

  if (!GOOGLE_CLIENT_ID) return null;

  return <div ref={divRef} className="flex justify-center" />;
};
