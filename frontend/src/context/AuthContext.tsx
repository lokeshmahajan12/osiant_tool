import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "../types";
import { api, clearToken, getToken, setToken } from "../lib/api";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (body: {
    name: string;
    username?: string;
    email: string;
    mobile?: string;
    password: string;
    confirmPassword: string;
    country?: string;
    state?: string;
    city?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { user: me } = await api.me();
      setUser(me);
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const login = async (identifier: string, password: string) => {
    const { token, user: loggedIn } = await api.login(identifier, password);
    setToken(token);
    setUser(loggedIn);
  };

  const register = async (body: {
    name: string;
    username?: string;
    email: string;
    mobile?: string;
    password: string;
    confirmPassword: string;
    country?: string;
    state?: string;
    city?: string;
  }) => {
    const { token, user: newUser } = await api.register(body);
    setToken(token);
    setUser(newUser);
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
