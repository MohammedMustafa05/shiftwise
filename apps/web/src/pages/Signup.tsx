import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ChefHat, AlertCircle, Mail, Lock, User, Building2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const inputStyle = {
  backgroundColor: '#18181B',
  border: '1px solid #3F3F46',
  color: '#FAFAFA',
} as const;

function focusInput(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.border = '1px solid #818CF8';
  e.target.style.boxShadow = '0 0 0 3px rgba(129,140,248,0.15)';
}
function blurInput(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.border = '1px solid #3F3F46';
  e.target.style.boxShadow = 'none';
}

export default function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [workplaceName, setWorkplaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';
    const { error } = await signUp({ name, email, password, workplaceName, timezone });
    setLoading(false);
    if (error) {
      setError(error);
    } else {
      navigate('/dashboard');
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        backgroundColor: '#09090B',
        backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(129,140,248,0.1) 0%, transparent 70%)',
      }}
    >
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div
            className="flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ backgroundColor: '#818CF8', boxShadow: '0 0 40px rgba(129,140,248,0.3)' }}
          >
            <ChefHat size={28} style={{ color: '#FFFFFF' }} />
          </div>
          <h1 className="text-2xl font-semibold" style={{ color: '#FAFAFA' }}>ShiftAgent</h1>
          <p className="text-sm mt-1" style={{ color: '#71717A' }}>Restaurant Scheduling Platform</p>
        </div>

        <div
          className="rounded-2xl p-8"
          style={{ backgroundColor: '#27272A', border: '1px solid #3F3F46', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}
        >
          <h2 className="text-lg font-semibold mb-1" style={{ color: '#FAFAFA' }}>Create your account</h2>
          <p className="text-sm mb-6" style={{ color: '#A1A1AA' }}>Set up your restaurant in a minute</p>

          {error && (
            <div
              className="flex items-center gap-2.5 text-sm rounded-lg px-4 py-3 mb-5"
              style={{ backgroundColor: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', color: '#F87171' }}
            >
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#71717A', letterSpacing: '0.06em' }}>
                Your name
              </label>
              <div className="relative">
                <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#71717A' }} />
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Alex Manager" required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm transition-all outline-none" style={inputStyle} onFocus={focusInput} onBlur={blurInput} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#71717A', letterSpacing: '0.06em' }}>
                Restaurant name
              </label>
              <div className="relative">
                <Building2 size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#71717A' }} />
                <input type="text" value={workplaceName} onChange={e => setWorkplaceName(e.target.value)} placeholder="The Corner Bistro" required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm transition-all outline-none" style={inputStyle} onFocus={focusInput} onBlur={blurInput} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#71717A', letterSpacing: '0.06em' }}>
                Email address
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#71717A' }} />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="manager@restaurant.com" required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm transition-all outline-none" style={inputStyle} onFocus={focusInput} onBlur={blurInput} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#71717A', letterSpacing: '0.06em' }}>
                Password
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#71717A' }} />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" required minLength={8}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm transition-all outline-none" style={inputStyle} onFocus={focusInput} onBlur={blurInput} />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-all mt-2"
              style={{ backgroundColor: loading ? '#6366F1' : '#818CF8', color: '#FFFFFF', opacity: loading ? 0.75 : 1 }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.backgroundColor = '#6366F1'; }}
              onMouseLeave={e => { if (!loading) (e.currentTarget as HTMLElement).style.backgroundColor = '#818CF8'; }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#FFFFFF' }} />
                  Creating account...
                </span>
              ) : 'Create Account'}
            </button>
          </form>

          <div className="text-center mt-5">
            <span className="text-xs" style={{ color: '#71717A' }}>Already have an account? </span>
            <Link to="/login" className="text-xs font-medium" style={{ color: '#818CF8' }}>Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
