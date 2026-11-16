import { Route, Routes } from 'react-router';
import { MemberDetailPage } from './MemberDetailPage';
import { MembersPage } from './MembersPage';

/** members/ — the list, and members/:memberId — one member. */
export function MembersSection() {
  return (
    <Routes>
      <Route index element={<MembersPage />} />
      <Route path=":memberId" element={<MemberDetailPage />} />
    </Routes>
  );
}
