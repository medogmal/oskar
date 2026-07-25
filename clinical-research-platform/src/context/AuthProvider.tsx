import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiBaseUrl, clearStoredAuth, getStoredAuth, setStoredAuth, type AccountType, type AuthUser } from '../lib/auth';
import { AuthContext, type AuthContextValue } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredAuth());
  const [isLoading, setIsLoading] = useState(true);

  const token = user?.token ?? null;

  const signIn = (authUser: AuthUser) => {
    setStoredAuth(authUser);
    setUser(authUser);
  };

  const signOut = () => {
    clearStoredAuth();
    setUser(null);
  };

  const refreshUser = async () => {
    const stored = getStoredAuth();

    if (!stored?.token) {
      setUser(null);
      return null;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/auth/me`, {
        headers: {
          Authorization: `Bearer ${stored.token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unauthorized');
      }

      const currentUser = (await response.json()) as Omit<AuthUser, 'token'>;
      const nextUser = {
        ...currentUser,
        token: stored.token,
        accountType: currentUser.accountType as AccountType,
      };

      setStoredAuth(nextUser);
      setUser(nextUser);
      return nextUser;
    } catch {
      clearStoredAuth();
      setUser(null);
      return null;
    }
  };

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      const stored = getStoredAuth();

      if (!stored?.token) {
        if (isMounted) {
          setIsLoading(false);
        }
        return;
      }

      await refreshUser();

      if (isMounted) {
        setIsLoading(false);
      }
    };

    void initialize();

    return () => {
      isMounted = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: Boolean(user?.token),
      signIn,
      signOut,
      refreshUser,
    }),
    [isLoading, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
