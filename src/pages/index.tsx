
import { useNavigate } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'
import WayviaLanding from '../components/wayvia-landing'

export default function Landing() {
  const navigate = useNavigate()

  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing">
        <WayviaLanding onStart={() => navigate('/home')} />
      </div>
    </>
  )
}
