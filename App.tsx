
import React, { useState, useEffect } from 'react';
import Home from './screens/Home';
import LeadsList from './screens/LeadsList';
import LeadDetail from './screens/LeadDetail';
import InventoryList from './screens/InventoryList';
import VeraChat from './screens/VeraChat';
import Metrics from './screens/Metrics';
import Docs from './screens/Docs';
import Opportunity from './screens/Opportunity';
import Simulator from './screens/Simulator';
import Developers from './screens/Developers';
import FolderView from './screens/FolderView';
import Notifications from './screens/Notifications';
import Settings from './screens/Settings';
import ProfileEdit from './screens/ProfileEdit';
import IntegrationsConfig from './screens/IntegrationsConfig';
import Management from './screens/Management';
import DriveCurator from './screens/DriveCurator';
import UserManagement from './screens/UserManagement';
import Training from './screens/Training';
import TrainingLesson from './screens/TrainingLesson';
import TrainingExam from './screens/TrainingExam';
import TrainingCurator from './screens/TrainingCurator';
import VeraConfigScreen from './screens/VeraConfig';
import Login from './screens/Login';
import { Lead, Notification, Developer, Lesson, TrainingModule, User, ExamQuestion } from './types';
import { INCORPORADORAS_INICIAIS, TRAINING_INITIAL_DATA, MOCK_USER, EXAM_QUESTIONS_INITIAL, PSM_LOGO_COMPONENT, MOCK_LEADS } from './constants';
import { dataService } from './services/dataService';
import { supabase } from './supabaseClient';

type Screen = 'LOGIN' | 'HOME' | 'LEADS_LIST' | 'LEAD_DETAIL' | 'INVENTORY_LIST' | 'VERA_CHAT' | 'OPPORTUNITY' | 'SIMULATOR' | 'INCORPORADORAS' | 'FOLDER_VIEW' | 'NOTIFICATIONS' | 'SETTINGS' | 'PROFILE_EDIT' | 'INTEGRATIONS_CONFIG' | 'MANAGEMENT' | 'METRICS' | 'DRIVE_CURATOR' | 'USER_MANAGEMENT' | 'TRAINING' | 'TRAINING_LESSON' | 'TRAINING_EXAM' | 'TRAINING_CURATOR' | 'VERA_CONFIG';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [users, setUsers] = useState<User[]>([{ ...MOCK_USER, password: 'psm', isActive: true }]);
  const [leads, setLeads] = useState<Lead[]>(MOCK_LEADS);
  const [developers, setDevelopers] = useState<Developer[]>(INCORPORADORAS_INICIAIS);
  const [trainingModules, setTrainingModules] = useState<TrainingModule[]>(TRAINING_INITIAL_DATA);
  const [currentScreen, setCurrentScreen] = useState<Screen>('HOME');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedDev, setSelectedDev] = useState<any>(null);
  const [veraContext, setVeraContext] = useState<string | null>(null);
  
  const hasSupabase = !!supabase;

  useEffect(() => {
    async function initData() {
      try {
        const [cloudUsers, cloudLeads, cloudDevs, cloudTraining] = await Promise.all([
          dataService.getUsers(),
          dataService.getLeads(),
          dataService.getDevelopers(),
          dataService.getTraining()
        ]);

        if (cloudUsers?.length > 0) setUsers(cloudUsers);
        if (cloudLeads?.length > 0) setLeads(cloudLeads);
        if (cloudDevs?.length > 0) setDevelopers(cloudDevs);
        if (cloudTraining?.length > 0) setTrainingModules(cloudTraining);
        
        setIsDataLoaded(true);
      } catch (e) {
        setIsDataLoaded(true);
      }
    }
    initData();
  }, [hasSupabase]);

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('psm_active_session');
    setCurrentScreen('HOME');
  };

  const seedDatabase = async () => {
    if (!supabase) return alert("⚠️ ERRO: Configure o Vercel primeiro.");
    try {
      await dataService.saveUser(users[0]);
      await dataService.saveLeads(MOCK_LEADS);
      await dataService.saveDevelopers(INCORPORADORAS_INICIAIS);
      alert("✅ SUCESSO: Banco ativado!");
    } catch (e: any) {
      alert(`❌ Erro: ${e.message}`);
    }
  };

  if (!currentUser) {
    return <Login onLogin={(u) => { setCurrentUser(u); }} availableUsers={users} />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-brand-cream relative">
      {/* Menu Lateral Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-brand-navy/10 z-30 shadow-xl">
        <div className="p-8 border-b border-brand-navy/5">{PSM_LOGO_COMPONENT("h-10")}</div>
        <nav className="flex-1 overflow-y-auto py-4">
          {[
            { id: 'HOME', icon: '⚡', label: 'Início' },
            { id: 'LEADS_LIST', icon: '🎯', label: 'Leads' },
            { id: 'INCORPORADORAS', icon: '🏢', label: 'Pastas' },
            { id: 'TRAINING', icon: '🎓', label: 'Academia' },
            { id: 'SETTINGS', icon: '⚙️', label: 'Ajustes' },
          ].map(item => (
            <button 
              key={item.id} 
              onClick={() => setCurrentScreen(item.id as Screen)} 
              className={`flex items-center w-full px-6 py-4 space-x-4 transition-all ${currentScreen === item.id ? 'bg-brand-navy/5 text-brand-navy border-r-4 border-brand-navy font-black' : 'text-gray-400 opacity-60 hover:opacity-100'}`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-[10px] uppercase tracking-widest">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Status bar superior de emergência */}
        <div className={`px-4 py-2 flex items-center justify-between text-[8px] font-black uppercase tracking-widest ${hasSupabase ? 'bg-green-600/10 text-green-700' : 'bg-brand-navy text-brand-cream'}`}>
          <div className="flex items-center space-x-2">
            <span className={`w-1.5 h-1.5 rounded-full ${hasSupabase ? 'bg-green-500 animate-pulse' : 'bg-white animate-pulse'}`}></span>
            <span>{hasSupabase ? 'Conexão Cloud OK' : 'Modo de Segurança PSM: Tudo salvando localmente'}</span>
          </div>
          {!hasSupabase && <button onClick={() => setCurrentScreen('SETTINGS')} className="underline">Como Ativar Cloud</button>}
        </div>

        <header className="bg-white px-6 py-4 border-b border-brand-navy/5 flex items-center justify-between z-40">
           <div className="md:hidden">{PSM_LOGO_COMPONENT("h-6")}</div>
           <h1 className="hidden md:block text-xs font-black text-brand-navy uppercase tracking-widest">{currentScreen.replace('_', ' ')}</h1>
           <button onClick={() => setCurrentScreen('SETTINGS')} className="w-10 h-10 bg-brand-cream rounded-2xl flex items-center justify-center text-sm shadow-inner">👤</button>
        </header>

        <main className="flex-1 overflow-y-auto bg-brand-cream">
          {currentScreen === 'HOME' && <Home leads={leads} devs={developers} onOpenLead={(l) => { setSelectedLead(l); setCurrentScreen('LEAD_DETAIL'); }} onOpenVera={() => setCurrentScreen('VERA_CHAT')} onNavigate={setCurrentScreen} />}
          {currentScreen === 'LEADS_LIST' && <LeadsList leads={leads} onLeadClick={(l) => { setSelectedLead(l); setCurrentScreen('LEAD_DETAIL'); }} />}
          {currentScreen === 'INCORPORADORAS' && <Developers devs={developers} onDevClick={(d) => { setSelectedDev(d); setCurrentScreen('FOLDER_VIEW'); }} onNavigate={setCurrentScreen} user={currentUser} />}
          {currentScreen === 'SETTINGS' && <Settings user={currentUser} onNavigate={setCurrentScreen} onLogout={handleLogout} onSeed={seedDatabase} />}
          {currentScreen === 'LEAD_DETAIL' && selectedLead && <LeadDetail lead={selectedLead} onBack={() => setCurrentScreen('LEADS_LIST')} onAskVera={(ctx) => { setVeraContext(ctx); setCurrentScreen('VERA_CHAT'); }} />}
          {currentScreen === 'FOLDER_VIEW' && selectedDev && <FolderView dev={selectedDev} onBack={() => setCurrentScreen('INCORPORADORAS')} />}
          {currentScreen === 'VERA_CHAT' && <VeraChat initialContext={veraContext} onClearContext={() => setVeraContext(null)} />}
          {currentScreen === 'TRAINING' && <Training modules={trainingModules} user={currentUser} onOpenLesson={() => {}} onOpenExam={() => {}} onNavigate={setCurrentScreen} />}
        </main>
      </div>
    </div>
  );
};

export default App;
