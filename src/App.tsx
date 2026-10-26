import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { MotionConfig } from 'framer-motion'
import { Layout } from './components/layout/Layout'
import { RouteError } from './components/layout/RouteError'
import HomePage from './pages/HomePage'

// Route-level code splitting: the homepage ships in the main bundle, the rest load on demand.
const EpisodesPage = lazy(() => import('./pages/EpisodesPage'))
const EpisodePage = lazy(() => import('./pages/EpisodePage'))
const ClipsPage = lazy(() => import('./pages/ClipsPage'))
const BooksPage = lazy(() => import('./pages/BooksPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const TellYourStoryPage = lazy(() => import('./pages/TellYourStoryPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const NewsPage = lazy(() => import('./pages/NewsPage'))
const NewsArticlePage = lazy(() => import('./pages/NewsArticlePage'))
const NewsletterPage = lazy(() => import('./pages/NewsletterPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
// Owner dashboard: its own layout, loaded only when someone opens /admin.
const AdminApp = lazy(() => import('./admin/AdminApp'))
const AdminOverview = lazy(() => import('./admin/OverviewPage'))
const AdminStories = lazy(() => import('./admin/StoriesPage'))
const AdminNotifications = lazy(() => import('./admin/NotificationsPage'))
const AdminSettings = lazy(() => import('./admin/SettingsPage'))
const AdminSocial = lazy(() => import('./admin/social/SocialPage'))
const AdminResetPassword = lazy(() => import('./admin/ResetPasswordPage'))
const AdminVideo = lazy(() => import('./admin/VideoPage'))
const AdminShorts = lazy(() => import('./admin/ShortsPage'))
const AdminNewsAgent = lazy(() => import('./admin/NewsAgentPage'))
const AdminNews = lazy(() => import('./admin/NewsPage'))
const AdminNewsletter = lazy(() => import('./admin/NewsletterPage'))
const AdminCalendar = lazy(() => import('./admin/CalendarPage'))
const AdminYouTube = lazy(() => import('./admin/YouTubePage'))
const AdminAnalytics = lazy(() => import('./admin/AnalyticsPage'))
const AdminTeam = lazy(() => import('./admin/TeamPage'))

const router = createBrowserRouter([
  {
    path: 'admin',
    element: (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <AdminOverview /> },
      { path: 'stories', element: <AdminStories /> },
      { path: 'social', element: <AdminSocial /> },
      { path: 'video', element: <AdminVideo /> },
      { path: 'shorts', element: <AdminShorts /> },
      { path: 'news-agent', element: <AdminNewsAgent /> },
      { path: 'news', element: <AdminNews /> },
      { path: 'newsletter', element: <AdminNewsletter /> },
      { path: 'calendar', element: <AdminCalendar /> },
      { path: 'youtube', element: <AdminYouTube /> },
      { path: 'analytics', element: <AdminAnalytics /> },
      { path: 'team', element: <AdminTeam /> },
      { path: 'notifications', element: <AdminNotifications /> },
      { path: 'settings', element: <AdminSettings /> },
      { path: '*', element: <Navigate to="/admin" replace /> },
    ],
  },
  {
    path: 'admin/reset',
    element: (
      <Suspense fallback={null}>
        <AdminResetPassword />
      </Suspense>
    ),
  },
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'episodes', element: <EpisodesPage /> },
      { path: 'episodes/:slug', element: <EpisodePage /> },
      { path: 'clips', element: <ClipsPage /> },
      { path: 'books', element: <BooksPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'tell-your-story', element: <TellYourStoryPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'news', element: <NewsPage /> },
      { path: 'news/:slug', element: <NewsArticlePage /> },
      { path: 'newsletter', element: <NewsletterPage /> },
      // The old password-protected inbox is now the dashboard's Story Inbox.
      { path: 'inbox', element: <Navigate to="/admin/stories" replace /> },
      // URLs from the site's earlier layout
      { path: 'videos', element: <Navigate to="/episodes" replace /> },
      { path: 'latest', element: <Navigate to="/episodes" replace /> },
      { path: 'contact', element: <Navigate to="/tell-your-story" replace /> },
      { path: 'collaborate', element: <Navigate to="/tell-your-story" replace /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
], { basename: import.meta.env.BASE_URL })

export default function App() {
  return (
    // reducedMotion="user" turns off transform/opacity animations for people who prefer reduced motion
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
    </MotionConfig>
  )
}
