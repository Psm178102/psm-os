
import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { veraService } from '../services/geminiService';
import { supabase } from '../supabaseClient';

interface SettingsProps {
  user: User;
  onNavigate: (screen: any) => void;
  onLogout: () => void;
  onSeed?: () => void;
}

const Settings: React.FC<SettingsProps> = ({ user, onNavigate, onLogout, onSeed }) => {
  const isHead = user.role === 'HEAD';
  const [cloudInfo, setCloudInfo] = useState<any>((window as any).PSM_CLOUD || { status: 'OFFLINE' });
  const [isTesting, setIsTesting] = useState(false);

  const refreshStatus = async () => {
    setIsTesting(true);
    await veraService.testConnection();
    setCloudInfo({ ...(window as any).PSM_CLOUD });
    setIsTesting(false);
  };

  return (
    <div className="flex flex-col min-h-full bg-brand-cream">
      <div className="p-10 bg-white border-b border-brand-navy/5 text-center">
        <div className="w-20 h-20 bg-brand-navy rounded-[2rem] mx-auto flex items-center justify-center overflow-hidden shadow-2xl mb-4 border-4 border-white">
          {user.photo_url ? <img src={user.photo_url} alt={user.name} className="w-full h-full object-cover" /> : <span className="text-2xl font-black text-brand-cream">{user.name[0]}</span>}
        </div>
        <h2 className="text-xl font-black text-brand-navy uppercase tracking-tighter">{user.name}</h2>
        <p className="text-[8px] font-bold text-brand-dark/40 uppercase tracking-[0.2em] mt-1">{user.role}</p>
      </div>

      <div className="p-4 space-y-6 pb-24 max-w-xl mx-auto w-full">
        
        {/* GUIA DE RESGATE VERCEL */}
        {!cloudInfo.config?.hasUrl && (
          <section className="bg-brand-navy text-brand-cream p-8 rounded-[3rem] shadow-2xl space-y-6">
            <div className="flex items-center space-x-4 border-b border-white/10 pb-4">
              <span className="text-3xl">🧩</span>
              <h3 className="text-xs font-black uppercase tracking-widest leading-none">Repositório não encontrado?</h3>
            </div>
            
            <div className="space-y-4">
               <div className="flex items-start space-x-3">
                  <span className="text-xl">1️⃣</span>
                  <p className="text-[10px] leading-relaxed">Você precisa primeiro <b>colocar este código no seu GitHub</b>. Use o botão "Export" ou "Push to GitHub" na barra lateral da sua ferramenta de código.</p>
               </div>
               <div className="flex items-start space-x-3">
                  <span className="text-xl">2️⃣</span>
                  <p className="text-[10px] leading-relaxed">Só depois que o código estiver lá é que ele aparecerá no Vercel em <b>"Connect to Git"</b>.</p>
               </div>
               <div className="flex items-start space-x-3">
                  <span className="text-xl">3️⃣</span>
                  <p className="text-[10px] leading-relaxed">Se já fez isso e o Vercel não vê as chaves, vá em <b>Deployments > Redeploy</b>.</p>
               </div>
            </div>

            <button onClick={() => window.open('https://github.com/new', '_blank')} className="w-full bg-white text-brand-navy py-4 rounded-2xl font-black text-[10px] uppercase shadow-xl hover:scale-105 transition-all">
              Criar Novo Repositório no GitHub
            </button>
          </section>
        )}

        {/* Status Infra */}
        <section className="bg-white p-6 rounded-[2.5rem] border border-brand-navy/5 shadow-sm space-y-4">
           <div className="flex justify-between items-center mb-2">
              <h4 className="text-[9px] font-black text-brand-navy uppercase tracking-widest">Painel de Diagnóstico</h4>
              <span className={`text-[8px] font-black px-3 py-1 rounded-full ${cloudInfo.status === 'ONLINE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {cloudInfo.status}
              </span>
           </div>

           <div className="grid grid-cols-2 gap-3">
              <div className="bg-brand-cream/50 p-4 rounded-2xl">
                 <div className="text-[7px] font-bold text-gray-400 uppercase">Banco Dados</div>
                 <div className="text-xs mt-1 font-black">{cloudInfo.config?.hasUrl ? 'ATIVO' : 'X'}</div>
              </div>
              <div className="bg-brand-cream/50 p-4 rounded-2xl">
                 <div className="text-[7px] font-bold text-gray-400 uppercase">Vera IA</div>
                 <div className="text-xs mt-1 font-black">{cloudInfo.config?.hasIA ? 'ATIVO' : 'X'}</div>
              </div>
           </div>

           <button onClick={refreshStatus} className="w-full text-[8px] font-black text-brand-navy/30 uppercase tracking-widest py-2">
             {isTesting ? 'Validando...' : 'Re-testar Conexão Cloud'}
           </button>
        </section>

        <div className="space-y-3">
          <button onClick={() => onNavigate('PROFILE_EDIT')} className="w-full flex items-center justify-between p-6 bg-white rounded-[2rem] border border-brand-navy/5 shadow-sm active:scale-95 transition-all">
             <div className="flex items-center space-x-4">
               <span className="text-xl">👤</span>
               <span className="text-[10px] font-black uppercase tracking-widest">Meu Perfil PSM</span>
             </div>
             <span className="opacity-20">›</span>
          </button>
          
          <button onClick={onLogout} className="w-full bg-white text-red-500 py-6 rounded-[2rem] font-black text-[10px] uppercase border border-red-50 shadow-sm active:scale-95 transition-all">
            Sair da Sessão
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
