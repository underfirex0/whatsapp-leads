import { NavLink, Outlet } from 'react-router';
import { BarChart3, Building2, CreditCard, Inbox, MessagesSquare, Send, Settings } from 'lucide-react';
import { useLive } from '../runtime';

export function AdminLayout() {
  const counts = useLive(async (app) => {
    const [demands, conversations, companies] = await Promise.all([app.repo.listDemands(), app.repo.listConversations(), app.repo.listCompanies()]);
    return {
      pending: demands.filter((d) => d.status === 'NEW' || d.status === 'IN_REVIEW').length,
      active: conversations.filter((c) => c.status === 'ACTIVE').length,
      requests: companies.filter((c) => c.subscription.requestedAt).length,
      failed: (await app.repo.listDistributions()).filter((d) => d.deliveryStatus === 'FAILED').length,
    };
  });
  const c = counts.data;

  const links = (
    <>
      <NavLink end to="/admin" className="nav-link">
        <BarChart3 size={16} /> Vue d’ensemble
      </NavLink>
      <div className="nav-section">Opérations</div>
      <NavLink to="/admin/conversations" className="nav-link">
        <MessagesSquare size={16} /> Conversations
        {c && c.active > 0 && <span className="count">{c.active}</span>}
      </NavLink>
      <NavLink to="/admin/demandes" className="nav-link">
        <Inbox size={16} /> Demandes
        {c && c.pending > 0 && <span className="count alert">{c.pending}</span>}
      </NavLink>
      <NavLink to="/admin/distributions" className="nav-link">
        <Send size={16} /> Distributions
        {c && c.failed > 0 && <span className="count" title="Envois en échec">{c.failed} ⚠</span>}
      </NavLink>
      <div className="nav-section">Commercial</div>
      <NavLink to="/admin/entreprises" className="nav-link">
        <Building2 size={16} /> Entreprises
      </NavLink>
      <NavLink to="/admin/abonnements" className="nav-link">
        <CreditCard size={16} /> Abonnements
        {c && c.requests > 0 && <span className="count alert">{c.requests}</span>}
      </NavLink>
      <div className="nav-section">Système</div>
      <NavLink to="/admin/parametres" className="nav-link">
        <Settings size={16} /> Paramètres
      </NavLink>
    </>
  );

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Navigation administration">
        <div className="brand">
          <span className="logo">T</span>
          <div>
            <b>Telecontact Leads</b>
            <span>Administration</span>
          </div>
        </div>
        {links}
      </aside>
      <div className="main">
        <nav className="mobile-nav" aria-label="Navigation administration">
          {links}
        </nav>
        <Outlet />
      </div>
    </div>
  );
}
