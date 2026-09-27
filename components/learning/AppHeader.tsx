'use client';

import { LogOut, Rocket, Star } from 'lucide-react';
import type { User } from '@/lib/learning-types';

export function AppHeader({
  user,
  onLogout,
  disabled = false,
}: {
  user: User;
  onLogout: () => void | Promise<void>;
  /** 退出登录等关键流程进行中时禁用退出按钮，避免重复触发。 */
  disabled?: boolean;
}) {
  return (
    <header className="relative z-10 border-b border-white/70 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-11 -rotate-6 place-items-center rounded-2xl bg-[#6755D9] text-white shadow-[0_7px_0_#4E3DC4]">
            <Rocket className="size-6" />
          </span>
          <div>
            <p className="font-title text-xl font-black">口算星球</p>
            <p className="text-xs font-bold text-[#8B94A7]">
              每天一小步，数学一大步
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full bg-[#FFF7D9] px-4 py-2 text-sm font-extrabold text-[#A86600] sm:inline-flex">
            <Star className="mr-1 size-4 fill-[#FFC740]" />
            {user.displayName}
          </span>
          <button
            className="soft-button"
            onClick={onLogout}
            title="退出登录"
            disabled={disabled}
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">退出</span>
          </button>
        </div>
      </div>
    </header>
  );
}
