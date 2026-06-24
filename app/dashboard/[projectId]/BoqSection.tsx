'use client'

import BoqUpload from './BoqUpload'

interface Props {
  projectId: string
  boqUploaded: boolean
}

export default function BoqSection({ projectId, boqUploaded }: Props) {
  return (
    <BoqUpload
      projectId={projectId}
      boqUploaded={boqUploaded}
      onSuccess={() => setTimeout(() => window.location.reload(), 1500)}
    />
  )
}
