import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChefHat, AlertCircle, Mail, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { isApiConfigured } from '../lib/api';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await signIn(email, password);
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
        {/* Logo */}
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

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            backgroundColor: '#27272A',
            border: '1px solid #3F3F46',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          }}
        >
          <h2 className="text-lg font-semibold mb-1" style={{ color: '#FAFAFA' }}>Welcome back</h2>
          <p className="text-sm mb-6" style={{ color: '#A1A1AA' }}>Sign in to your manager account</p>

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
            {/* Email */}
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#71717A', letterSpacing: '0.06em' }}>
                Email address
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#71717A' }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="manager@restaurant.com"
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm transition-all outline-none"
                  style={{
                    backgroundColor: '#18181B',
                    border: '1px solid #3F3F46',
                    color: '#FAFAFA',
                  }}
                  onFocus={e => {
                    e.target.style.border = '1px solid #818CF8';
                    e.target.style.boxShadow = '0 0 0 3px rgba(129,140,248,0.15)';
                  }}
                  onBlur={e => {
                    e.target.style.border = '1px solid #3F3F46';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: '#71717A', letterSpacing: '0.06em' }}>
                Password
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#71717A' }} />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm transition-all outline-none"
                  style={{
                    backgroundColor: '#18181B',
                    border: '1px solid #3F3F46',
                    color: '#FAFAFA',
                  }}
                  onFocus={e => {
                    e.target.style.border = '1px solid #818CF8';
                    e.target.style.boxShadow = '0 0 0 3px rgba(129,140,248,0.15)';
                  }}
                  onBlur={e => {
                    e.target.style.border = '1px solid #3F3F46';
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-all mt-2"
              style={{
                backgroundColor: loading ? '#6366F1' : '#818CF8',
                color: '#FFFFFF',
                opacity: loading ? 0.75 : 1,
              }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.backgroundColor = '#6366F1'; }}
              onMouseLeave={e => { if (!loading) (e.currentTarget as HTMLElement).style.backgroundColor = '#818CF8'; }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.25)', borderTopColor: '#FFFFFF' }} />
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="text-center mt-5">
            <button className="text-xs transition-colors" style={{ color: '#71717A' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#818CF8'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#71717A'}
            >
              Forgot password?
            </button>
          </div>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: '#52525B' }}>
          {isApiConfigured
            ? 'Demo: employer@demo.com / password123'
            : 'Demo: any email + password (min 4 chars)'}
        </p>
      </div>
    </div>
  );
}
