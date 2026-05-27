import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  CalendarDays, LayoutDashboard, Users, ClipboardCheck,
  Settings, LogOut, ChefHat, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getInitials, getAvatarColor } from '../lib/utils';

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  badge?: number;
}

const navItems: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/schedule',  icon: CalendarDays,    label: 'Schedule'  },
  { to: '/employees', icon: Users,           label: 'Employees' },
  { to: '/approvals', icon: ClipboardCheck,  label: 'Approvals', badge: 4 },
  { to: '/preferences', icon: Settings,      label: 'Preferences' },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

function NavItemRow({ to, icon: Icon, label, badge, collapsed }: NavItem & { collapsed: boolean }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <NavLink
        to={to}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-150 ${
            isActive
              ? 'bg-[#818CF8]/10 text-[#818CF8]'
              : 'text-[#71717A] hover:bg-[#27272A] hover:text-[#FAFAFA]'
          }`
        }
        style={{ padding: collapsed ? '10px 0' : '10px 12px', justifyContent: collapsed ? 'center' : undefined }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Icon size={17} />
        {!collapsed && <span className="flex-1">{label}</span>}
        {!collapsed && badge && badge > 0 && (
          <span
            className="flex items-center justify-center text-xs font-semibold rounded-full min-w-[20px] h-5 px-1.5"
            style={{ backgroundColor: 'rgba(129,140,248,0.15)', color: '#818CF8' }}
          >
            {badge}
          </span>
        )}
      </NavLink>

      {collapsed && hovered && (
        <div style={{
          position: 'absolute', left: 52, top: '50%', transform: 'translateY(-50%)',
          backgroundColor: '#27272A', color: '#FAFAFA', fontSize: 12,
          borderRadius: 6, padding: '4px 10px', whiteSpace: 'nowrap',
          border: '1px solid #3F3F46', zIndex: 100, pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {label}
          {badge && badge > 0 && (
            <span style={{ marginLeft: 6, color: '#818CF8', fontWeight: 600 }}>{badge}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const displayName = (user?.user_metadata?.name as string) ?? user?.email?.split('@')[0] ?? 'Manager';
  const email = user?.email ?? 'manager@shiftagent.com';
  const avatarColor = getAvatarColor(displayName);
  const initials = getInitials(displayName);

  async function handleLogout() {
    await signOut();
    navigate('/login');
  }

  return (
    <aside
      style={{
        width: collapsed ? 64 : 240,
        backgroundColor: '#09090B',
        borderRight: '1px solid #3F3F46',
        transition: 'width 200ms ease-in-out',
      }}
      className="fixed left-0 top-0 bottom-0 flex flex-col z-40 overflow-hidden"
    >
      {/* Logo + Toggle */}
      <div
        className="flex items-center px-4 py-5 shrink-0"
        style={{
          borderBottom: '1px solid #3F3F46',
          justifyContent: collapsed ? 'center' : 'space-between',
          position: 'relative',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0" style={{ backgroundColor: '#818CF8' }}>
            <ChefHat size={16} style={{ color: '#FFFFFF' }} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate" style={{ color: '#FAFAFA' }}>ShiftAgent</div>
              <div className="text-xs truncate" style={{ color: '#71717A' }}>Scheduling Platform</div>
            </div>
          )}
        </div>

        {/* Toggle button */}
        <button
          onClick={onToggle}
          className="flex items-center justify-center transition-colors shrink-0"
          style={{
            width: 22, height: 22, borderRadius: '50%',
            backgroundColor: '#27272A', border: '1px solid #3F3F46',
            color: '#71717A', cursor: 'pointer',
            position: collapsed ? 'absolute' : 'static',
            right: collapsed ? -11 : undefined,
            top: collapsed ? '50%' : undefined,
            transform: collapsed ? 'translateY(-50%)' : undefined,
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#3F3F46'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = '#27272A'}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 overflow-y-auto overflow-x-hidden">
        {!collapsed && (
          <div className="text-xs font-medium uppercase tracking-widest mb-3 px-3" style={{ color: '#71717A', letterSpacing: '0.08em' }}>
            Main Menu
          </div>
        )}
        <div className="space-y-0.5">
          {navItems.map(item => (
            <NavItemRow key={item.to} {...item} collapsed={collapsed} />
          ))}
        </div>
      </nav>

      {/* User */}
      <div className="px-2 pb-4 shrink-0" style={{ borderTop: '1px solid #3F3F46', paddingTop: '12px' }}>
        {!collapsed && (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1" style={{ backgroundColor: '#18181B' }}>
            <div
              className="flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold shrink-0"
              style={{ backgroundColor: avatarColor, color: '#FFFFFF' }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: '#FAFAFA' }}>{displayName}</div>
              <div className="text-xs truncate" style={{ color: '#71717A' }}>{email}</div>
            </div>
          </div>
        )}

        {collapsed ? (
          <div style={{ position: 'relative' }}>
            <button
              onClick={handleLogout}
              className="flex items-center justify-center w-full py-2 rounded-lg transition-all"
              style={{ color: '#71717A' }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = '#27272A';
                (e.currentTarget as HTMLElement).style.color = '#F87171';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLElement).style.color = '#71717A';
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm transition-all"
            style={{ color: '#A1A1AA' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = '#27272A';
              (e.currentTarget as HTMLElement).style.color = '#F87171';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
              (e.currentTarget as HTMLElement).style.color = '#A1A1AA';
            }}
          >
            <LogOut size={15} />
            Sign out
          </button>
        )}
      </div>
    </aside>
  );
}
