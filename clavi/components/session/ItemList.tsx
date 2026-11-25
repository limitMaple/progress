import { Fragment, type ReactNode } from "react";

/** 「一覧」の見出しと、1 件ずつの部品を並べたもの。どのタブの一覧もこれを使う。 */
export default function ItemList<T extends { id: string }>({ items, empty, action, renderItem }: {
    items: T[];
    /** 一覧が空のときの文 */
    empty: string;
    /** 見出しの右に置くもの */
    action?: ReactNode;
    renderItem(item: T): ReactNode;
}) {
    return (
        <section>
            <div className="section-head">
                <h2>一覧</h2>
                {action}
            </div>
            <ul className="session-list">
                {/* 1 件の部品が <li> を描く */}
                {items.map((item) => <Fragment key={item.id}>{renderItem(item)}</Fragment>)}
            </ul>
            {items.length === 0 && <p className="muted">{empty}</p>}
        </section>
    );
}
