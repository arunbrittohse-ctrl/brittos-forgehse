import { Link } from '../lib/router';
import { Empty } from '../components/ui';

export function NotFound({ publicPage }: { publicPage?: boolean }) {
  return (
    <div style={{ padding: publicPage ? 64 : 0 }}>
      <Empty title="This page doesn't exist" action={<Link to={publicPage ? '/' : '/app'} className="btn">{publicPage ? 'Go to the home page' : 'Go to the dashboard'}</Link>}>
        The link may be out of date, or the record may be outside the projects you can access.
      </Empty>
    </div>
  );
}
