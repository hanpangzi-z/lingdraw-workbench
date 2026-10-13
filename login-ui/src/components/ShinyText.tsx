import { motion } from 'framer-motion'

type ShinyTextProps = {
  children: string
  className?: string
  baseColor?: string
  middleColor?: string
  endColor?: string
  shineColor?: string
  speed?: number
  spread?: number
}

export function ShinyText({
  children,
  className = '',
  baseColor = '#7C3AED',
  middleColor = '#3B82F6',
  endColor = '#22D3EE',
  shineColor = '#ffffff',
  speed = 3,
  spread = 100,
}: ShinyTextProps) {
  return (
    <motion.span
      className={className}
      style={{
        display: 'inline-block',
        color: 'transparent',
        backgroundImage: `linear-gradient(${spread}deg, ${baseColor} 0%, ${middleColor} 34%, ${endColor} 44%, ${shineColor} 50%, ${endColor} 56%, ${middleColor} 66%, ${baseColor} 100%)`,
        backgroundSize: '220% 100%',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}
      initial={{ backgroundPosition: '220% 50%' }}
      animate={{ backgroundPosition: '-120% 50%' }}
      transition={{ duration: speed, ease: 'linear', repeat: Infinity }}
    >
      {children}
    </motion.span>
  )
}
