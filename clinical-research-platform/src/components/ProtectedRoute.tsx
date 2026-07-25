import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/useAuth';
import { getDashboardPath, type AccountType } from '../lib/auth';

type ProtectedRouteProps = {
  allowedRoles?: AccountType[];
  publicOnly?: boolean;
};

function ProtectedRoute({ allowedRoles, publicOnly = false }: ProtectedRouteProps) {
  const { t } = useTranslation();
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-6 py-4">{t('dashboard.common.loading')}</div>
      </div>
    );
  }

  if (publicOnly) {
    if (isAuthenticated && user) {
      return <Navigate to={getDashboardPath(user.accountType)} replace />;
    }

    return <Outlet />;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.accountType)) {
    return <Navigate to={getDashboardPath(user.accountType)} replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;
