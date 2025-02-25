#ifndef COMPONENT_H
#define COMPONENT_H

class Component
{
public:
    Component();
    ~Component();

    void print();
    int getPrintCount();

private:
    int printCount{0};
};

#endif