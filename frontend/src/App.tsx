import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { wakeBackend } from './components/ui/WakingNote'
import PageTransition from './components/layout/PageTransition'
import Navbar from './components/layout/Navbar'
import { AlertBanner } from './components/free/Alerts'
import HomePage from './pages/HomePage'
import MapPage from './pages/MapPage'
import SearchPage from './pages/SearchPage'
import ChatPage from './pages/ChatPage'
import CostPage from './pages/CostPage'
import PreferencesPage from './pages/PreferencesPage'
import RidesPage from './pages/RidesPage'
import FreePage from './pages/FreePage'
import ProfilePage from './pages/ProfilePage'
import AuthDonePage from './pages/AuthDonePage'
import WelcomeToast from './components/layout/WelcomeToast'
import ScoutWidget from './components/chat/ScoutWidget'
import Splash from './components/layout/Splash'
import Tour from './components/layout/Tour'
import ReportPage from './pages/ReportPage'
import EmergencyPage from './pages/EmergencyPage'

export default function App() {
  const location = useLocation()
  const { pathname } = location
  useEffect(() => { wakeBackend() }, [])
  return (
    <div className="flex h-full flex-col">
      <Navbar />
      <AlertBanner />
      <WelcomeToast />
      <Tour />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <PageTransition k={pathname}>
        <Routes location={location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/ask" element={<ChatPage />} />
          <Route path="/true-cost" element={<CostPage />} />
          <Route path="/preferences" element={<PreferencesPage />} />
          <Route path="/rides" element={<RidesPage />} />
          <Route path="/free" element={<FreePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/auth/done" element={<AuthDonePage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/emergency" element={<EmergencyPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
        </PageTransition>
      </main>
      <ScoutWidget />
      <Splash />
    </div>
  )
}
