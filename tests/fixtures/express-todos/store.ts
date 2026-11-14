export class TodoStore {
  private items: { id: number; title: string; done: boolean }[] = [];
  private nextId = 1;

  list() {
    return this.items;
  }

  add(title: string) {
    const item = { id: this.nextId++, title, done: false };
    this.items.push(item);
    return item;
  }
}
