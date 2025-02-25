#ifndef NAMESPACE_SUBCOMPONENT_H
#define NAMESPACE_SUBCOMPONENT_H

namespace Namespace
{

class SubComponent
{
public:
    SubComponent();
    ~SubComponent();

    void print();
    int getPrintCount();

private:
    int printCount{0};
};

}

#endif