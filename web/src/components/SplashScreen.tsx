import './SplashScreen.css'
import sealIcon from '../assets/seal.png'

const TITLE = 'Cookie'

export function SplashScreen() {
  return (
    <div className="splash">
      <div className="splash-avatar-wrap">
        <img src={sealIcon} alt="Cookie" />
      </div>
      <div className="splash-title">
        {TITLE.split('').map((char, i) => (
          <span key={i}>{char}</span>
        ))}
      </div>
      <div className="splash-subtitle">REACT AGENT</div>
      <div className="splash-dots">
        <span />
        <span />
        <span />
      </div>
    </div>
  )
}
