export default function DashboardPage() {
  return (
    <div>
      <h1 style={{ margin: '0 0 .5rem', fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>Project Overview</h1>
      <p style={{ margin: '0 0 2rem', color: '#64748b' }}>Upload your master BOQ to get started.</p>
      <div style={{
        background: 'white', borderRadius: '12px', border: '2px dashed #e2e8f0',
        padding: '4rem 2rem', textAlign: 'center', color: '#94a3b8'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📂</div>
        <p style={{ margin: 0, fontSize: '1rem' }}>
          No BOQ loaded. Go to{' '}
          <a href="/dashboard/settings" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>Settings</a>
          {' '}to upload your master file.
        </p>
      </div>
    </div>
  )
}
