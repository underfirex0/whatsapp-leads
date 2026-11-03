import { useState } from 'react';
import { createBrowserRouter, NavLink, Outlet, RouterProvider, useNavigate, useRouteError } from 'react-router';
import { Building2, FlaskConical, LayoutDashboard, RotateCcw, Store } from 'lucide-react';
import { ConfirmDialog, Toasts, Notice, Button } from './components';
import { ToastProvider, useRuntime, useToast } from './runtime';
import { DirectoryHome, FichePage } from './directory/Directory';
import { AdminLayout } from './admin/AdminLayout';
import { Overview } from './admin/Overview';
import { DemandsList } from './admin/DemandsList';
import { DemandDetail } from './admin/DemandDetail';
import { ConversationsList, ConversationDetail } from './admin/Conversations';
import { CompaniesList } from './admin/CompaniesList';
import { CompanyDetail } from './admin/CompanyDetail';
import { DistributionsLog } from './admin/Distributions';
import { Subscriptions } from './admin/Subscriptions';
import { SettingsPage } from './admin/Settings';
import { CompanyPicker, CompanyWorkspace } from './company/Workspace';

function DemoBar() {
  const runtime = useRuntime();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="demobar">
      <span className="tag" title="Toutes les données sont fictives et stockées dans ce navigateur">
        <FlaskConical size={13} /> Prototype <span className="long">· données de démonstration</span>
      </span>
      <nav aria-label="Espaces">
        <NavLink to="/" end className={({ isActive }) => (isActive || location.pathname.startsWith('/fiche') ? 'active' : '')}>
          <Store size={14} /> <span>Telecontact (visiteur)</span>
        </NavLink>
        <NavLink to="/admin">
          <LayoutDashboard size={14} /> <span>Administration</span>
        </NavLink>
        <NavLink to="/espace">
          <Building2 size={14} /> <span>Espace entreprise</span>
        </NavLink>
      </nav>
      <span className="spacer" />
      <span className="journey small">Fiche → WhatsApp → Demande → Matching → Distribution</span>
      <button className="link" onClick={() => setConfirm(true)}>
        <RotateCcw size={13} /> Réinitialiser
      </button>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Réinitialiser la démonstration ?"
        description="Toutes les données reviennent à l’état initial (entreprises, conversations, demandes, distributions). Vos tests seront effacés."
        confirmLabel="Réinitialiser"
        danger
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          await runtime.reset();
          try {
            localStorage.removeItem('telecontact-sim-identity');
          } catch {
            /* ignore */
          }
          setBusy(false);
          setConfirm(false);
          toast({ kind: 'success', message: 'Démonstration réinitialisée' });
          navigate('/');
          location.reload();
        }}
      />
    </div>
  );
}

function Root() {
  return (
    <ToastProvider render={(t, d) => <Toasts toasts={t} dismiss={d} />}>
      <DemoBar />
      <Outlet />
    </ToastProvider>
  );
}

function RouteError() {
  const err = useRouteError() as Error & { status?: number };
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <Notice tone={err?.status === 404 ? 'info' : 'danger'} title={err?.status === 404 ? 'Page introuvable' : 'Une erreur est survenue'}>
        {err?.status === 404 ? 'Cette adresse ne correspond à aucune page.' : err?.message}
        <div style={{ marginTop: 10 }}>
          <Button size="sm" onClick={() => (location.href = '/')}>
            Retour à l’accueil
          </Button>
        </div>
      </Notice>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <DirectoryHome /> },
      { path: '/fiche/:slug', element: <FichePage /> },
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <Overview /> },
          { path: 'demandes', element: <DemandsList /> },
          { path: 'demandes/:id', element: <DemandDetail /> },
          { path: 'conversations', element: <ConversationsList /> },
          { path: 'conversations/:id', element: <ConversationDetail /> },
          { path: 'entreprises', element: <CompaniesList /> },
          { path: 'entreprises/:id', element: <CompanyDetail /> },
          { path: 'distributions', element: <DistributionsLog /> },
          { path: 'abonnements', element: <Subscriptions /> },
          { path: 'parametres', element: <SettingsPage /> },
        ],
      },
      { path: '/espace', element: <CompanyPicker /> },
      { path: '/espace/:companyId', element: <CompanyWorkspace /> },
      { path: '*', element: <RouteError /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
