
import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { Compass, ArrowRight, ArrowLeft, Users, ShieldCheck } from 'lucide-react'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel() {
  const [showAuthModal, setShowAuthModal] = useState(false)

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-[#080D19] text-white">

      {/* Left — Cinematic travel photography */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden p-12">
        <img
          src="/san-diego-coast.png"
          alt="Scenic coastal destination"
          className="absolute inset-0 h-full w-full object-cover"
        />

        <div className="absolute inset-0 bg-gradient-to-t from-[#080D19] via-[#080D19]/40 to-black/20" />

        <Link to="/" className="relative z-10 flex items-center gap-3">
          <Compass className="h-8 w-8 text-indigo-300" />
          <span className="text-2xl font-bold tracking-tight">
            wayvia.
          </span>
        </Link>

        <div className="relative z-10 max-w-xl pb-12">
          <p className="mb-5 text-xs uppercase tracking-[0.3em] text-indigo-300">
            Your journey. Our way.
          </p>

          <h1 className="text-5xl xl:text-6xl font-semibold leading-tight tracking-tight">
            Great journeys begin
            <span className="block italic text-indigo-300">
              together.
            </span>
          </h1>

          <p className="mt-6 max-w-md text-lg leading-relaxed text-white/70">
            Discover new places, bring your favorite people,
            and turn shared ideas into unforgettable adventures.
          </p>
        </div>

        <p className="relative z-10 text-xs text-white/50">
          Explore more. Plan less. Travel together.
        </p>
      </div>

      {/* Right — Authentication */}
      <div className="relative flex min-h-screen flex-col items-center justify-center px-8 py-16">

        <Link
          to="/"
          className="absolute left-8 top-8 flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <div className="w-full max-w-md">

          <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl border border-indigo-400/20 bg-indigo-500/10">
            <Compass className="h-7 w-7 text-indigo-300" />
          </div>

          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400">
            Your next adventure awaits
          </p>

          <h2 className="text-4xl font-semibold tracking-tight">
            Welcome to Wayvia.
          </h2>

          <p className="mt-4 text-base leading-relaxed text-slate-400">
            Sign in to create trips, collaborate with friends,
            and plan your next adventure in one shared space.
          </p>

          <button
            onClick={() => setShowAuthModal(true)}
            className="mt-9 flex w-full items-center justify-center gap-3 rounded-xl bg-indigo-500 px-6 py-4 font-semibold text-white transition hover:bg-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300"
          >
            Continue to Wayvia
            <ArrowRight className="h-5 w-5" />
          </button>

          <div className="my-8 h-px bg-white/10" />

          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <Users className="h-5 w-5 shrink-0 text-indigo-400" />
              <div>
                <p className="text-sm font-medium">
                  Better together
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Plan and collaborate with your travel group.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <ShieldCheck className="h-5 w-5 shrink-0 text-indigo-400" />
              <div>
                <p className="text-sm font-medium">
                  Secure authentication
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Powered by DeepSpace.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-12 text-center text-xs text-slate-500">
            Wayvia · Your journey. Our way.
          </p>
        </div>
      </div>

      {showAuthModal && (
  <AuthOverlay
    providers={['google']}
    onClose={() => setShowAuthModal(false)}
  />
)}
    </div>
  )
}
