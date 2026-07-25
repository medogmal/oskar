import { createContext } from 'react';
import type { AuthUser } from '../lib/auth';

export type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (user: AuthUser) => void;
  signOut: () => void;
  refreshUser: () => Promise<AuthUser | null>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
