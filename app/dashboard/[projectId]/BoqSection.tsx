'use client'

import { useRouter } from 'next/navigation'
import BoqUpload from './BoqUpload'

interface Props {
  projectId: string
  boqUploaded: boolean
}

export default function BoqSection({ projectId, boqUploaded }: Props) {
  const router = useRouter()
  return (
    <BoqUpload
      projectId={projectId}
      boqUploaded={boqUploaded}
      onSuccess={() => setTimeout(() => window.location.reload(), 1500)}
    />
  )
}
