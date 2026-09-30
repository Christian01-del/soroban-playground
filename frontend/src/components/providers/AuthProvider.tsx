"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SessionManager } from "@/lib/auth/session";
import { useWallet } from "./WalletProvider";

const AuthContext = createContext<ReturnType<typeof useSession> | null>(null);

function useSession() {
  const wallet = useWallet();
  const [manager] = useState(
    () =>
      new SessionManager(
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000",
        {
          serverAccount: process.env.NEXT_PUBLIC_SEP10_SERVER_ACCOUNT || "",
          homeDomain: process.env.NEXT_PUBLIC_SEP10_HOME_DOMAIN || "localhost",
          webAuthDomain:
            process.env.NEXT_PUBLIC_SEP10_WEB_AUTH_DOMAIN ||
            process.env.NEXT_PUBLIC_SEP10_HOME_DOMAIN ||
            "localhost",
          networkPassphrase:
            process.env.NEXT_PUBLIC_SEP10_NETWORK_PASSPHRASE ||
            "Test SDF Network ; November 2015",
        },
      ),
  );
  const session = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getServerSnapshot,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const identity = `${wallet.address || ""}:${wallet.network || ""}`;
  const previousIdentity = useRef(identity);
  const accountMismatch =
    !!session.user && !!wallet.address && session.user.id !== wallet.address;
  const validSession = !accountMismatch;
  useEffect(() => {
    void manager.refresh().catch(() => {});
  }, [manager]);
  useLayoutEffect(() => {
    if (accountMismatch) {
      void manager
        .logout()
        .catch(() => setError("Session logout failed; please retry"));
    } else if (previousIdentity.current !== identity) {
      const previous = previousIdentity.current;
      previousIdentity.current = identity;
      if (
        previous !== ":" ||
        (session.user && session.user.id !== wallet.address)
      ) {
        void manager
          .logout()
          .catch(() => setError("Session logout failed; please retry"));
      }
    }
  }, [identity, manager, session.user, wallet.address, accountMismatch]);
  useEffect(() => {
    if (!session.token) return;
    const timer = setTimeout(
      () => {
        void manager
          .refresh()
          .catch(() => setError("Session expired. Sign in again."));
      },
      Math.max(0, session.expiresAt - Date.now() - 60000),
    );
    return () => clearTimeout(timer);
  }, [manager, session.token, session.expiresAt]);
  const getAuthToken = useCallback(
    async () => (validSession ? manager.getAuthToken() : null),
    [manager, validSession],
  );
  return {
    ...session,
    token: validSession ? session.token : null,
    user: validSession ? session.user : null,
    isAuthenticated: validSession && !!session.token,
    isLoading,
    error,
    getAuthToken,
    login: async () => {
      setLoading(true);
      setError(null);
      try {
        if (!wallet.address || wallet.status !== "connected")
          throw new Error("Connect a wallet first");
        await manager.login(wallet.address, wallet.signTransaction);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Sign in failed");
        throw error;
      } finally {
        setLoading(false);
      }
    },
    logout: async () => {
      setError(null);
      try {
        await manager.logout();
      } catch (error) {
        setError("Session logout failed; please retry");
        throw error;
      }
    },
  };
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useSession();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}
export function useAuthContext() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used within an AuthProvider");
  return auth;
}
