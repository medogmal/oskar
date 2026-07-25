import { useTranslation } from 'react-i18next';

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  const changeLanguage = (language: 'en' | 'ar') => {
    i18n.changeLanguage(language);
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={() => changeLanguage('en')}
        className={`px-4 py-2 rounded-xl font-semibold transition-all ${
          i18n.language === 'en'
            ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-lg'
            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
        }`}
      >
        EN
      </button>
      <button
        onClick={() => changeLanguage('ar')}
        className={`px-4 py-2 rounded-xl font-semibold transition-all ${
          i18n.language === 'ar'
            ? 'bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-lg'
            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
        }`}
      >
        عربي
      </button>
    </div>
  );
};

export default LanguageSwitcher;
