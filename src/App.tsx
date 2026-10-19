import { lazy } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { MotionConfig } from 'framer-motion'
import { Layout } from './components/layout/Layout'
import { RouteError } from './components/layout/RouteError'
import HomePage from './pages/HomePage'

// Route-level code splitting: the homepage ships in the main bundle, the rest load on demand.
const EpisodesPage = lazy(() => import('./pages/EpisodesPage'))
const EpisodePage = lazy(() => import('./pages/EpisodePage'))
const ClipsPage = lazy(() => import('./pages/ClipsPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const TellYourStoryPage = lazy(() => import('./pages/TellYourStoryPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const InboxPage = lazy(() => import('./pages/InboxPage'))

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'episodes', element: <EpisodesPage /> },
      { path: 'episodes/:slug', element: <EpisodePage /> },
      { path: 'clips', element: <ClipsPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: 'tell-your-story', element: <TellYourStoryPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      // Private: password-protected, not linked from the site
      { path: 'inbox', element: <InboxPage /> },
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
