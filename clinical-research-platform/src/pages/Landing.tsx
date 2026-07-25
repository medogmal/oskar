import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Brain,
  FileText,
  BarChart3,
  ShieldCheck,
  Users,
  Activity,
  ChevronRight,
} from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';

function Landing() {
  const { t } = useTranslation();
  
  const features = [
    {
      icon: Brain,
      title: t('landing.features.protocol.title'),
      description: t('landing.features.protocol.desc')
    },
    {
      icon: FileText,
      title: t('landing.features.crf.title'),
      description: t('landing.features.crf.desc')
    },
    {
      icon: BarChart3,
      title: t('landing.features.statistics.title'),
      description: t('landing.features.statistics.desc')
    },
    {
      icon: ShieldCheck,
      title: t('landing.features.compliance.title'),
      description: t('landing.features.compliance.desc')
    },
    {
      icon: Users,
      title: t('landing.features.collaboration.title'),
      description: t('landing.features.collaboration.desc')
    },
    {
      icon: Activity,
      title: t('landing.features.monitoring.title'),
      description: t('landing.features.monitoring.desc')
    }
  ];

  const stats = [
    { value: "500+", label: t('landing.stats.studies') },
    { value: "10k+", label: t('landing.stats.patients') },
    { value: "99.9%", label: t('landing.stats.uptime') },
    { value: "50+", label: t('landing.stats.institutions') }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-slate-950/60 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-teal-500 rounded-xl flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent">
              ClinResearch AI
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/subscriptions" className="text-slate-300 hover:text-white font-medium transition-colors">
              Plans
            </Link>
            <LanguageSwitcher />
            <Link to="/login" className="text-slate-300 hover:text-white font-medium transition-colors">
              {t('nav.login')}
            </Link>
            <Link
              to="/signup"
              className="bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white px-6 py-3 rounded-2xl font-semibold transition-all hover:shadow-lg hover:shadow-blue-500/25"
            >
              {t('nav.getStarted')}
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-full mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              <span className="text-blue-300 text-sm font-medium">{t('landing.badge')}</span>
            </div>
            <h1 className="text-5xl lg:text-7xl font-bold leading-tight mb-6">
              {t('landing.title')}
            </h1>
            <p className="text-xl text-slate-400 mb-10 leading-relaxed">
              {t('landing.subtitle')}
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                to="/signup"
                className="group bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white px-8 py-4 rounded-2xl font-semibold text-lg transition-all hover:shadow-xl hover:shadow-blue-500/30 flex items-center gap-2"
              >
                {t('landing.startFreeTrial')}
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <button className="border border-slate-700 hover:border-slate-600 text-white px-8 py-4 rounded-2xl font-semibold text-lg transition-all hover:bg-slate-800/50">
                {t('landing.watchDemo')}
              </button>
              <Link
                to="/subscriptions"
                className="border border-blue-500/40 bg-blue-500/10 px-8 py-4 rounded-2xl font-semibold text-lg text-blue-100 transition-all hover:bg-blue-500/20"
              >
                View Plans
              </Link>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-r from-blue-600/30 to-teal-600/30 blur-3xl rounded-3xl"></div>
            <div className="relative bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
              </div>
              <div className="space-y-4">
                <div className="bg-gradient-to-r from-blue-500/10 to-teal-500/10 border border-blue-500/20 rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <Brain className="w-8 h-8 text-blue-400" />
                    <div>
                      <div className="text-sm text-slate-400">{t('landing.preview.protocol.label')}</div>
                      <div className="text-lg font-semibold">{t('landing.preview.protocol.status')}</div>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <FileText className="w-8 h-8 text-teal-400" />
                    <div>
                      <div className="text-sm text-slate-400">{t('landing.preview.crf.label')}</div>
                      <div className="text-lg font-semibold">{t('landing.preview.crf.status')}</div>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <BarChart3 className="w-8 h-8 text-cyan-400" />
                    <div>
                      <div className="text-sm text-slate-400">{t('landing.preview.statistics.label')}</div>
                      <div className="text-lg font-semibold">{t('landing.preview.statistics.status')}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="border-y border-slate-800 py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent mb-2">
                  {stat.value}
                </div>
                <div className="text-slate-400">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold mb-6">
            {t('landing.features.title')}
          </h2>
          <p className="text-xl text-slate-400 max-w-2xl mx-auto">
            {t('landing.features.subtitle')}
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="group bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-500/10 transition-all"
              >
                <div className="w-14 h-14 bg-gradient-to-br from-blue-500/20 to-teal-500/20 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Icon className="w-7 h-7 text-blue-400" />
                </div>
                <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                <p className="text-slate-400 leading-relaxed">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-4xl mx-auto px-6 py-24">
        <div className="bg-gradient-to-r from-blue-600 via-teal-600 to-cyan-600 rounded-3xl p-12 text-center shadow-2xl shadow-blue-500/30">
          <h2 className="text-3xl lg:text-4xl font-bold mb-6">
            {t('landing.cta.title')}
          </h2>
          <p className="text-xl text-blue-100 mb-10 max-w-2xl mx-auto">
            {t('landing.cta.subtitle')}
          </p>
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 bg-white text-blue-700 px-10 py-4 rounded-2xl font-bold text-lg hover:bg-blue-50 transition-all hover:shadow-xl"
          >
            {t('landing.cta.button')}
            <ChevronRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-teal-500 rounded-lg flex items-center justify-center">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-teal-400 bg-clip-text text-transparent">
                ClinResearch AI
              </span>
            </div>
            <div className="text-slate-500">
              {t('landing.footer.copyright')}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;
