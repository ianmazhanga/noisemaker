import { Seo } from '../components/seo/Seo'
import { Hero } from '../components/home/Hero'
import { Conversations } from '../components/home/Conversations'
import { LatestConversations } from '../components/home/LatestConversations'
import { Moments } from '../components/home/Moments'
import { Noisemakers } from '../components/home/Noisemakers'
import { Community } from '../components/home/Community'
import { seriesLd, websiteLd } from '../lib/structuredData'

export default function HomePage() {
  return (
    <>
      <Seo jsonLd={[seriesLd(), websiteLd()]} />
      <Hero />
      <Conversations />
      <LatestConversations />
      <Moments />
      <Noisemakers />
      <Community />
    </>
  )
}
